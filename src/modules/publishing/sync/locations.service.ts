import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortalConnection } from '../domain/portal-connection.entity';
import { PortalLocation } from '../domain/portal-location.entity';
import type { SetLocationDto } from '../publishing.dto';
import type { RemoteLocation } from './connector';
import { ConnectorRegistry } from './connector-registry';
import { PortalSyncService } from './portal-sync.service';

/** Cuantas zonas intenta emparejar solo cada pulsacion: el portal limita peticiones. */
const AUTO_BATCH = 40;

/**
 * Emparejado de nuestras ciudades y zonas con las del portal.
 *
 * Solo se trabaja lo que tiene inmuebles publicables: de las miles de zonas
 * importadas de WASI, unas decenas cubren casi todo el inventario, y esas son
 * las que hay que revisar primero.
 */
@Injectable()
export class LocationsService {
  constructor(
    @InjectRepository(PortalLocation)
    private readonly locations: Repository<PortalLocation>,
    @InjectRepository(PortalConnection)
    private readonly conns: Repository<PortalConnection>,
    private readonly registry: ConnectorRegistry,
    private readonly sync: PortalSyncService,
  ) {}

  /** Ciudades y zonas con inmuebles activos, con su equivalencia si la hay. */
  async overview(portalId: number) {
    await this.connection(portalId);
    const rows: {
      cityId: number;
      cityName: string;
      zoneId: number | null;
      zoneName: string | null;
      properties: number;
    }[] = await this.locations.manager.query(
      `SELECT p.city_id AS "cityId", c.name AS "cityName",
              p.zone_id AS "zoneId", z.name AS "zoneName",
              count(*)::int AS "properties"
         FROM property p
         JOIN city c ON c.id = p.city_id
    LEFT JOIN zone z ON z.id = p.zone_id
        WHERE p.deleted_at IS NULL
          AND NOT p.is_sample
          AND p.publication_status IN ('ACTIVE', 'OUTSTANDING')
     GROUP BY p.city_id, c.name, p.zone_id, z.name
     ORDER BY count(*) DESC`,
    );
    const mapped = await this.locations.find({ where: { portalId } });
    const key = (cityId: number, zoneId: number | null) =>
      `${cityId}:${zoneId ?? 0}`;
    const byKey = new Map(mapped.map((m) => [key(m.cityId, m.zoneId), m]));

    // Una fila por ciudad (su equivalencia de respaldo) y una por zona.
    const cities = new Map<
      number,
      { cityId: number; cityName: string; properties: number }
    >();
    for (const r of rows) {
      const c = cities.get(r.cityId) ?? {
        cityId: r.cityId,
        cityName: r.cityName,
        properties: 0,
      };
      c.properties += r.properties;
      cities.set(r.cityId, c);
    }
    return {
      cities: [...cities.values()].map((c) => ({
        ...c,
        mapping: byKey.get(key(c.cityId, null)) ?? null,
      })),
      zones: rows
        .filter((r) => r.zoneId)
        .map((r) => ({
          ...r,
          mapping: byKey.get(key(r.cityId, r.zoneId)) ?? null,
        })),
    };
  }

  async search(
    portalId: number,
    query: string,
    cityId?: number,
  ): Promise<RemoteLocation[]> {
    const q = query.trim();
    if (q.length < 3)
      throw new BadRequestException('Escribe al menos 3 letras');
    const { connector, conn } = await this.connection(portalId);
    return connector.searchLocations!(
      await this.sync.context(conn),
      q,
      cityId ? await this.within(portalId, cityId) : undefined,
    );
  }

  /** Nuestra ciudad y, si ya esta emparejada, su id en el portal. */
  private async within(portalId: number, cityId: number) {
    const [city]: { name?: string }[] = await this.locations.manager.query(
      `SELECT name FROM city WHERE id = $1`,
      [cityId],
    );
    const mapped = await this.locations
      .createQueryBuilder('l')
      .where(
        'l.portal_id = :portalId AND l.city_id = :cityId AND l.zone_id IS NULL',
        { portalId, cityId },
      )
      .getOne();
    return {
      cityName: city?.name ?? '',
      cityExternalId: mapped?.externalId ?? null,
    };
  }

  async set(portalId: number, dto: SetLocationDto): Promise<PortalLocation> {
    await this.connection(portalId);
    const zoneId = dto.zoneId ?? null;
    let row = await this.locations
      .createQueryBuilder('l')
      .where(
        'l.portal_id = :portalId AND l.city_id = :cityId AND l.zone_key = :zoneKey',
        {
          portalId,
          cityId: dto.cityId,
          zoneKey: zoneId ?? 0,
        },
      )
      .getOne();
    row ??= this.locations.create({ portalId, cityId: dto.cityId, zoneId });
    row.externalId = dto.externalId;
    row.externalName = dto.externalName;
    row.extra = dto.extra ?? {};
    row.verified = true;
    const saved = await this.locations.save(row);
    // Lo que esperaba por falta de ubicacion puede salir ya.
    await this.sync.wakePortal(portalId);
    return saved;
  }

  async remove(portalId: number, id: string): Promise<void> {
    await this.locations.delete({ portalId, id });
  }

  /**
   * Propone equivalencias buscando cada zona en el portal. Solo acepta la
   * coincidencia exacta de nombre (sin tildes ni prefijos) dentro de la misma
   * ciudad; lo demas queda para revisar a mano. Las propuestas se usan pero
   * quedan sin verificar.
   */
  async autoMatch(
    portalId: number,
  ): Promise<{ tried: number; matched: number; remaining: number }> {
    const { connector, conn } = await this.connection(portalId);
    const ctx = await this.sync.context(conn);
    const { cities, zones } = await this.overview(portalId);

    const pending = [
      ...cities
        .filter((c) => !c.mapping)
        .map((c) => ({
          cityId: c.cityId,
          cityName: c.cityName,
          zoneId: null,
          zoneName: null,
        })),
      ...zones
        .filter((z) => !z.mapping)
        .map((z) => ({
          cityId: z.cityId,
          cityName: z.cityName,
          zoneId: z.zoneId,
          zoneName: z.zoneName,
        })),
    ];
    const batch = pending.slice(0, AUTO_BATCH);
    let matched = 0;

    // Las ciudades van primero en la tanda: los barrios se buscan dentro de
    // la ciudad ya emparejada, y hay portales que sin ella no saben buscar.
    for (const item of batch) {
      const target = item.zoneName ?? item.cityName;
      const within = item.zoneName
        ? await this.within(portalId, item.cityId)
        : { cityName: item.cityName, cityExternalId: null };
      let results: RemoteLocation[];
      try {
        results = await connector.searchLocations!(ctx, target, within);
      } catch {
        continue;
      }
      const hit = results.find(
        (r) =>
          norm(r.name) === norm(target) &&
          (item.zoneName
            ? !r.city ||
              norm(r.city) === norm(item.cityName) ||
              r.extra?.cityId === within.cityExternalId
            : /city|ciudad|municip/i.test(r.type)),
      );
      if (!hit) continue;
      const row = this.locations.create({
        portalId,
        cityId: item.cityId,
        zoneId: item.zoneId,
        externalId: hit.id,
        externalName: [hit.name, hit.city, hit.state]
          .filter(Boolean)
          .join(', '),
        extra: hit.extra ?? {},
        verified: false,
      });
      await this.locations.save(row);
      matched++;
    }
    if (matched) await this.sync.wakePortal(portalId);
    return {
      tried: batch.length,
      matched,
      remaining: pending.length - batch.length,
    };
  }

  private async connection(portalId: number) {
    const conn = await this.conns
      .createQueryBuilder('c')
      .addSelect('c.credentialsEnc')
      .leftJoinAndSelect('c.portal', 'portal')
      .where('c.portal_id = :portalId', { portalId })
      .getOne();
    if (!conn) throw new NotFoundException('Ese portal no tiene conexion');
    const connector = this.registry.get(conn.connector);
    if (!connector?.searchLocations) {
      throw new BadRequestException(
        'Este portal no necesita emparejar ubicaciones',
      );
    }
    return { conn, connector };
  }
}

/** Minusculas, sin tildes, sin prefijos de barrio y sin espacios de sobra. */
function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(
      /\b(barrio|urbanizacion|urb\.?|conjunto|condominio|sector|d\.c\.?)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
