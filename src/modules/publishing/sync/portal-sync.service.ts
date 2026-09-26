import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { Property } from '../../properties/domain/property.entity';
import { PortalConnection } from '../domain/portal-connection.entity';
import { PortalLocation } from '../domain/portal-location.entity';
import {
  PropertyPublication,
  PublicationState,
  SyncAction,
} from '../domain/property-publication.entity';
import {
  ConnectorContext,
  MappedLocation,
  PortalConfigError,
  PortalRejection,
  SyncOutcome,
} from './connector';
import { PortalTransientError } from './http';
import { ConnectorRegistry } from './connector-registry';
import { buildListing, listingHash, type PortalListing } from './listing';
import { decryptSecrets } from './secrets';

/** Espera tras cada fallo transitorio. Despues del ultimo, se abandona. */
const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3600_000,
  6 * 3600_000,
];

/** Una operacion asincrona sin respuesta en este tiempo se deja de consultar. */
const POLL_GIVE_UP_MS = 2 * 24 * 3600_000;
/** Y mientras tanto, no se pregunta mas de una vez por minuto. */
const POLL_EVERY_MS = 60_000;

/** Estados en los que hay un anuncio arriba que retirar. */
const LIVE = [PublicationState.PUBLISHED, PublicationState.PENDING];

/**
 * Envia los inmuebles a los portales.
 *
 * La cola es la propia `property_publication`: una fila con `pendingAction`
 * y `nextAttemptAt` vencido es trabajo por hacer. Entra trabajo por tres vias
 *
 *  - un inmueble nuevo, en todos los portales conectados con alta automatica;
 *  - el boton "Enviar / Actualizar" de la ficha, que ademas lo procesa en el
 *    acto para que quien lo pulsa vea el resultado;
 *  - un inmueble borrado, que se retira de donde estuviera.
 *
 * Editar un inmueble NO lo reenvia solo: el panel marca el anuncio como
 * desfasado y es el asesor quien decide cuando actualizar. Asi un cambio a
 * medias no sale a ocho portales.
 */
@Injectable()
export class PortalSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortalSyncService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  /** Una misma publicacion no se procesa dos veces a la vez (boton + cola). */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(PropertyPublication)
    private readonly pubs: Repository<PropertyPublication>,
    @InjectRepository(PortalConnection)
    private readonly conns: Repository<PortalConnection>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(PortalLocation)
    private readonly locations: Repository<PortalLocation>,
    private readonly registry: ConnectorRegistry,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      this.config.portals.intervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // --- entradas ------------------------------------------------------------

  /** El boton de la ficha: encola y procesa en el acto. */
  async syncNow(
    propertyId: string,
    portalId: number,
    action: SyncAction,
  ): Promise<PropertyPublication> {
    const conn = await this.conns.findOne({ where: { portalId } });
    if (!conn?.enabled) {
      throw new BadRequestException(
        'Este portal no esta conectado. Configuralo en Portales antes de enviar.',
      );
    }
    const pub = await this.enqueue(
      this.pubs.manager,
      propertyId,
      portalId,
      action,
    );
    await this.process(pub.id);
    return this.pubs.findOneOrFail({ where: { id: pub.id } });
  }

  /** Enviar o actualizar en todos los portales conectados. */
  async syncAll(propertyId: string): Promise<PropertyPublication[]> {
    const conns = await this.conns.find({ where: { enabled: true } });
    const ids: string[] = [];
    for (const conn of conns) {
      const pub = await this.enqueue(
        this.pubs.manager,
        propertyId,
        conn.portalId,
        SyncAction.UPSERT,
      );
      ids.push(pub.id);
    }
    await Promise.all(ids.map((id) => this.process(id)));
    return this.pubs.find({ where: { id: In(ids) } });
  }

  /**
   * Alta de un inmueble. Corre dentro de la transaccion que lo crea —con su
   * `manager`— porque fuera de ella el inmueble aun no existe y la clave ajena
   * fallaria.
   */
  async onPropertyCreated(
    manager: EntityManager,
    property: Property,
  ): Promise<void> {
    if (property.isSample) return;
    const conns = await manager.find(PortalConnection, {
      where: { enabled: true, autoPublishNew: true },
    });
    for (const conn of conns) {
      await this.enqueue(
        manager,
        property.id,
        conn.portalId,
        SyncAction.UPSERT,
      );
    }
  }

  /**
   * El inmueble cambio. Lo que estaba en espera —un borrador que no se podia
   * publicar— se vuelve a mirar; lo ya publicado no se toca.
   */
  async onPropertyChanged(
    manager: EntityManager,
    propertyId: string,
  ): Promise<void> {
    await manager.update(
      PropertyPublication,
      { propertyId, pendingAction: Not(IsNull()), nextAttemptAt: IsNull() },
      { nextAttemptAt: new Date() },
    );
  }

  /** Inmueble borrado: se retira de los portales conectados donde este arriba. */
  async onPropertyRemoved(
    manager: EntityManager,
    propertyId: string,
  ): Promise<void> {
    // Lo que aun no habia salido ya no tiene que salir.
    await manager.update(
      PropertyPublication,
      {
        propertyId,
        pendingAction: SyncAction.UPSERT,
        state: Not(In(LIVE)),
      },
      {
        pendingAction: null,
        nextAttemptAt: null,
        lastError: null,
        note: 'Cancelado: el inmueble se borro antes de enviarse',
      },
    );
    const enabled = await manager.find(PortalConnection, {
      where: { enabled: true },
    });
    if (!enabled.length) return;
    await manager.update(
      PropertyPublication,
      {
        propertyId,
        portalId: In(enabled.map((c) => c.portalId)),
        state: In(LIVE),
      },
      {
        pendingAction: SyncAction.REMOVE,
        nextAttemptAt: new Date(),
        attempts: 0,
        lastError: null,
      },
    );
  }

  /** Tras cambiar la configuracion de un portal, lo que esperaba se reintenta. */
  async wakePortal(portalId: number): Promise<void> {
    await this.pubs.update(
      { portalId, pendingAction: Not(IsNull()) },
      { nextAttemptAt: new Date(), attempts: 0 },
    );
  }

  async enqueue(
    manager: EntityManager,
    propertyId: string,
    portalId: number,
    action: SyncAction,
  ): Promise<PropertyPublication> {
    const repo = manager.getRepository(PropertyPublication);
    let pub = await repo.findOne({ where: { propertyId, portalId } });
    if (!pub) {
      pub = repo.create({
        propertyId,
        portalId,
        state: PublicationState.PENDING,
      });
    }
    pub.pendingAction = action;
    pub.nextAttemptAt = new Date();
    pub.attempts = 0;
    pub.lastError = null;
    return repo.save(pub);
  }

  // --- estado para el panel ------------------------------------------------

  /** Publicaciones del inmueble con lo que el panel necesita para los botones. */
  async describe(propertyId: string) {
    const [pubs, conns, listing] = await Promise.all([
      this.pubs.find({ where: { propertyId }, order: { portalId: 'ASC' } }),
      this.conns.find(),
      this.loadListing(propertyId),
    ]);
    const hash = listing ? listingHash(listing) : null;
    const byPortal = new Map(conns.map((c) => [c.portalId, c]));

    const rows = pubs.map((pub) => {
      const conn = byPortal.get(pub.portalId);
      const mode = conn
        ? (this.registry.get(conn.connector)?.mode ?? null)
        : null;
      return {
        ...pub,
        connected: Boolean(conn?.enabled),
        mode,
        // Un feed se genera en cada lectura con la ficha de ese momento:
        // nunca esta desfasado. Solo lo empujado a una API puede estarlo.
        outdated: Boolean(
          mode === 'push' &&
          pub.syncedHash &&
          hash &&
          pub.syncedHash !== hash &&
          pub.state === PublicationState.PUBLISHED,
        ),
      };
    });

    // Los portales conectados donde el inmueble todavia no esta tambien salen,
    // para que el boton "Enviar" exista aunque no haya fila.
    const missing = conns
      .filter((c) => c.enabled && !pubs.some((p) => p.portalId === c.portalId))
      .map((c) => ({
        id: null,
        propertyId,
        portalId: c.portalId,
        portal: c.portal,
        state: null,
        connected: true,
        mode: this.registry.get(c.connector)?.mode ?? null,
        outdated: false,
      }));

    return {
      publishable: listing?.publishable ?? false,
      blockers: listing?.blockers ?? ['El inmueble no existe'],
      publications: [...rows, ...missing],
    };
  }

  // --- la cola ---------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.pubs
        .createQueryBuilder('p')
        .select('p.id')
        .where('p.pending_action IS NOT NULL')
        .andWhere('p.next_attempt_at <= now()')
        .orderBy('p.next_attempt_at', 'ASC')
        .limit(20)
        .getMany();
      for (const { id } of due) await this.process(id);

      // Red de seguridad para lo que espera a que el inmueble se pueda
      // publicar: no toda escritura del inventario pasa por el suscriptor
      // (un `update` por consulta no dice que inmueble toco), asi que cada
      // hora se vuelve a mirar. Sin `lastError`: lo que espera por
      // configuracion lo despierta guardar la conexion, no el reloj.
      await this.pubs
        .createQueryBuilder()
        .update()
        .set({ nextAttemptAt: () => 'now()' })
        .where('pending_action IS NOT NULL')
        .andWhere('next_attempt_at IS NULL')
        .andWhere('last_error IS NULL')
        .andWhere("updated_at < now() - interval '1 hour'")
        .execute();

      const waiting = await this.pubs
        .createQueryBuilder('p')
        .where('p.transaction_id IS NOT NULL')
        .andWhere('p.pending_action IS NULL')
        .andWhere('p.state = :state', { state: PublicationState.PENDING })
        .andWhere('p.last_synced_at < :recent', {
          recent: new Date(Date.now() - POLL_EVERY_MS),
        })
        .andWhere('p.last_synced_at > :giveUp', {
          giveUp: new Date(Date.now() - POLL_GIVE_UP_MS),
        })
        .limit(20)
        .getMany();
      for (const pub of waiting) await this.poll(pub);
    } catch (err) {
      this.logger.error(`La cola de portales fallo: ${message(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  private process(id: string): Promise<void> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const job = this.run(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, job);
    return job;
  }

  private async run(id: string): Promise<void> {
    const pub = await this.pubs.findOne({ where: { id } });
    if (!pub?.pendingAction) return;
    const action = pub.pendingAction;

    const conn = await this.connection(pub.portalId);
    const connector = conn?.enabled ? this.registry.get(conn.connector) : null;
    if (!conn?.enabled || !connector) {
      pub.nextAttemptAt = null;
      pub.lastError = conn?.enabled
        ? 'Este portal todavia no tiene integracion.'
        : 'El portal no esta conectado.';
      await this.pubs.save(pub);
      return;
    }

    const listing = await this.loadListing(pub.propertyId);
    if (!listing) {
      pub.pendingAction = null;
      pub.nextAttemptAt = null;
      pub.lastError = 'El inmueble ya no existe.';
      await this.pubs.save(pub);
      return;
    }

    if (action === SyncAction.UPSERT && !listing.publishable) {
      // En espera, no en error: se reintenta cuando alguien edite la ficha.
      pub.nextAttemptAt = null;
      pub.lastError = null;
      pub.note = clip(`En espera: ${listing.blockers.join('; ')}`);
      await this.pubs.save(pub);
      return;
    }

    try {
      const ctx = await this.context(conn);

      if (action === SyncAction.UPSERT) {
        const faltas = await connector.validate(listing, ctx);
        if (faltas.length) throw new PortalRejection(faltas.join('; '));
      }

      const ref = {
        externalId: pub.externalId,
        transactionId: pub.transactionId,
      };
      const outcome =
        action === SyncAction.UPSERT
          ? await connector.upsert(ctx, listing, ref)
          : await connector.remove(ctx, listing, ref);

      this.apply(pub, outcome);
      pub.pendingAction = null;
      pub.nextAttemptAt = null;
      pub.attempts = 0;
      pub.lastSyncedAt = new Date();
      pub.syncedHash =
        action === SyncAction.UPSERT &&
        outcome.state !== PublicationState.REJECTED
          ? listingHash(listing)
          : null;
    } catch (err) {
      this.fail(pub, err);
    }
    await this.pubs.save(pub);
  }

  private async poll(pub: PropertyPublication): Promise<void> {
    const conn = await this.connection(pub.portalId);
    const connector = conn?.enabled ? this.registry.get(conn.connector) : null;
    if (!conn || !connector?.poll) return;
    try {
      const outcome = await connector.poll(
        await this.context(conn),
        { externalId: pub.externalId, transactionId: pub.transactionId },
        await this.loadListing(pub.propertyId),
      );
      if (outcome) this.apply(pub, outcome);
    } catch (err) {
      this.logger.warn(`Consulta a ${conn.portal.name} fallo: ${message(err)}`);
    }
    pub.lastSyncedAt = new Date();
    await this.pubs.save(pub);
  }

  /** Lo que el portal manda de vuelta a `/public/portal-callbacks/...`. */
  async callback(
    portalId: number,
    token: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<number> {
    const conn = await this.connection(portalId);
    if (!conn || !sameToken(conn.inboundToken, token))
      throw new NotFoundException();
    const connector = this.registry.get(conn.connector);
    if (!connector?.handleCallback) throw new NotFoundException();

    const ctx = await this.context(conn);
    // Se deja constancia del cuerpo crudo: hay portales (Metrocuadrado) cuyo
    // formato no esta documentado, y esto es lo que permite ajustarlo.
    this.logger.log(
      `Callback de ${conn.portal.name}: ${JSON.stringify(body).slice(0, 2000)}`,
    );
    const results = await connector.handleCallback(ctx, body, headers);
    let applied = 0;
    for (const result of results) {
      // Los conectores guardan la transaccion con una etapa delante
      // ("create:<id>"), y el portal solo conoce el id: se busca por el final.
      const pub = result.transactionId
        ? await this.pubs
            .createQueryBuilder('p')
            .where('p.portal_id = :portalId', { portalId })
            .andWhere(
              "(p.transaction_id = :tx OR p.transaction_id LIKE '%:' || :tx)",
              {
                tx: result.transactionId,
              },
            )
            .getOne()
        : result.reference
          ? await this.pubs
              .createQueryBuilder('p')
              .innerJoin('property', 'prop', 'prop.id = p.property_id')
              .where('p.portal_id = :portalId', { portalId })
              .andWhere('prop.code = :code', { code: result.reference })
              .getOne()
          : null;
      if (!pub) continue;
      if (result.outcome) {
        // Un "exito" que responde a una retirada es una retirada: hay portales
        // cuyo callback no dice que operacion confirma.
        const outcome =
          pub.transactionId?.startsWith('unpublish:') &&
          result.outcome.state === PublicationState.PUBLISHED
            ? { ...result.outcome, state: PublicationState.REMOVED }
            : result.outcome;
        this.apply(pub, outcome);
        pub.lastSyncedAt = new Date();
        await this.pubs.save(pub);
      } else {
        await this.poll(pub);
      }
      applied++;
    }
    return applied;
  }

  /** Lo que va en el feed de un agregador: lo publicado alli y publicable. */
  async feed(
    portalId: number,
    token: string,
  ): Promise<{
    connection: PortalConnection;
    listings: PortalListing[];
  }> {
    const conn = await this.connection(portalId);
    if (!conn?.enabled || !sameToken(conn.inboundToken, token)) {
      throw new NotFoundException();
    }
    const pubs = await this.pubs.find({
      select: { propertyId: true },
      where: { portalId, state: PublicationState.PUBLISHED },
    });
    const listings = await this.loadListings(pubs.map((p) => p.propertyId));
    return {
      connection: conn,
      listings: listings.filter((l) => l.publishable),
    };
  }

  // --- piezas --------------------------------------------------------------

  private apply(pub: PropertyPublication, outcome: SyncOutcome): void {
    pub.state = outcome.state;
    if (outcome.externalId !== undefined) pub.externalId = outcome.externalId;
    if (outcome.externalUrl !== undefined)
      pub.externalUrl = outcome.externalUrl;
    pub.transactionId =
      outcome.state === PublicationState.PENDING
        ? (outcome.transactionId ?? pub.transactionId)
        : null;
    pub.note = outcome.note ? clip(outcome.note) : null;
    pub.lastError =
      outcome.state === PublicationState.REJECTED
        ? (outcome.note ?? 'Rechazado')
        : null;
    if (outcome.state === PublicationState.PUBLISHED && !pub.publishedAt) {
      pub.publishedAt = new Date();
    }
  }

  private fail(pub: PropertyPublication, err: unknown): void {
    const text = message(err);
    if (err instanceof PortalRejection) {
      pub.state = PublicationState.REJECTED;
      pub.pendingAction = null;
      pub.nextAttemptAt = null;
      pub.lastError = text;
      return;
    }
    if (err instanceof PortalConfigError) {
      // Se queda pendiente y dormido: guardar la configuracion lo despierta.
      pub.nextAttemptAt = null;
      pub.lastError = text;
      return;
    }
    pub.attempts += 1;
    if (pub.attempts > BACKOFF_MS.length) {
      pub.pendingAction = null;
      pub.nextAttemptAt = null;
      pub.lastError = `Se dejo de intentar tras ${pub.attempts} fallos: ${text}`;
    } else {
      const wait =
        err instanceof PortalTransientError && err.retryAfterMs
          ? err.retryAfterMs
          : BACKOFF_MS[pub.attempts - 1];
      pub.nextAttemptAt = new Date(Date.now() + wait);
      pub.lastError = text;
    }
    this.logger.warn(`Publicacion ${pub.id} (portal ${pub.portalId}): ${text}`);
  }

  private connection(portalId: number): Promise<PortalConnection | null> {
    return this.conns
      .createQueryBuilder('c')
      .addSelect('c.credentialsEnc')
      .leftJoinAndSelect('c.portal', 'portal')
      .where('c.portal_id = :portalId', { portalId })
      .getOne();
  }

  async context(conn: PortalConnection): Promise<ConnectorContext> {
    const { secretKey } = this.config.portals;
    let credentials: Record<string, string> = {};
    if (conn.credentialsEnc) {
      if (!secretKey) {
        throw new PortalConfigError('Falta PORTALS_SECRET_KEY en el servidor.');
      }
      try {
        credentials = decryptSecrets(secretKey, conn.credentialsEnc);
      } catch {
        throw new PortalConfigError(
          'No se pudieron leer las credenciales guardadas. Vuelve a introducirlas.',
        );
      }
    }
    const map = await this.locations.find({
      where: { portalId: conn.portalId },
    });
    const byZone = new Map(
      map.filter((m) => m.zoneId).map((m) => [m.zoneId, m]),
    );
    const byCity = new Map(
      map.filter((m) => !m.zoneId).map((m) => [m.cityId, m]),
    );
    const mapped = (
      m: PortalLocation,
      level: 'zone' | 'city',
    ): MappedLocation => ({
      externalId: m.externalId,
      externalName: m.externalName,
      extra: m.extra,
      level,
      verified: m.verified,
    });

    return {
      portalId: conn.portalId,
      portalName: conn.portal?.name ?? `Portal ${conn.portalId}`,
      location: (listing) => {
        const zone = listing.zoneId ? byZone.get(listing.zoneId) : undefined;
        if (zone && zone.cityId === listing.cityId) return mapped(zone, 'zone');
        const city = byCity.get(listing.cityId);
        return city ? mapped(city, 'city') : null;
      },
      credentials,
      settings: {
        ...(this.config.portals.contactEmail
          ? { contactEmail: this.config.portals.contactEmail }
          : {}),
        ...(this.config.portals.contactPhone
          ? { contactPhone: this.config.portals.contactPhone }
          : {}),
        ...conn.settings,
      },
      sandbox: conn.sandbox,
      callbackUrl: `${this.apiBase()}/public/portal-callbacks/${conn.portalId}/${conn.inboundToken}`,
      saveSetting: async (key, value) => {
        conn.settings = { ...conn.settings, [key]: value };
        await this.conns.update(conn.portalId, { settings: conn.settings });
      },
    };
  }

  apiBase(): string {
    const { publicApiUrl, apiPrefix } = this.config.portals;
    return `${publicApiUrl}/${apiPrefix}`;
  }

  private urls() {
    return {
      site: this.config.publicSiteUrl.replace(/\/$/, ''),
      api: this.apiBase(),
    };
  }

  async loadListing(propertyId: string): Promise<PortalListing | null> {
    const [listing] = await this.loadListings([propertyId]);
    return listing ?? null;
  }

  private async loadListings(ids: string[]): Promise<PortalListing[]> {
    if (!ids.length) return [];
    const properties = await this.properties
      .createQueryBuilder('property')
      .withDeleted()
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('city.region', 'region')
      .leftJoinAndSelect('region.country', 'country')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.assignedAgent', 'assignedAgent')
      .leftJoinAndSelect('property.features', 'features')
      .leftJoinAndSelect('property.images', 'images')
      .where('property.id IN (:...ids)', { ids })
      .getMany();
    const urls = this.urls();
    return properties.map((p) => buildListing(p, urls));
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
