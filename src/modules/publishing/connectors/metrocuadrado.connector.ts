import { Injectable } from '@nestjs/common';
import { ConnectorKey } from '../domain/portal-connection.entity';
import { PublicationState } from '../domain/property-publication.entity';
import {
  PortalConfigError,
  PortalRejection,
  type ConnectorContext,
  type ConnectorField,
  type PortalConnector,
  type RemoteLocation,
  type RemoteRef,
  type SyncOutcome,
} from '../sync/connector';
import { portalFetch, PortalTransientError } from '../sync/http';
import type { PortalListing } from '../sync/listing';
import { stripControl } from '../sync/text';

/**
 * Metrocuadrado — API "PTEC Core".
 *
 *  - Token de una hora pedido con API key + usuario + clave + identificacion.
 *    Va en la cabecera `token`, no en `Authorization`.
 *  - Publicar, actualizar y despublicar son asincronos: el acuse trae un
 *    `transactionId` y el resultado llega al `responseUrl` (nuestro callback)
 *    o preguntando por la transaccion.
 *  - Actualizar es reemplazo completo, incluidas las fotos (de 3 a 20).
 *  - El formato del callback NO esta documentado: se lee de forma tolerante.
 *
 * `transactionId` guarda la operacion delante: publish:/update:/unpublish:.
 */
const HOSTS = {
  production: {
    token: 'https://third-party-apis.metrocuadrado.com',
    res: 'https://www.metrocuadrado.com',
  },
  dev: {
    token: 'https://ptec-core-dev-third-party-apis.metrocuadrado.com',
    res: 'https://ptec-core-dev.metrocuadrado.com',
  },
};
const NAME = 'Metrocuadrado';
/** Santander. Los barrios se buscan por ciudad; las ciudades, por region. */
const DEFAULT_REGION = '26';

/** Nuestro tipo (ids de WASI) → tipo de Metrocuadrado y amenities que fija el tipo. */
const TYPE: Record<
  number,
  { id: number; flags?: Record<string, string | boolean> }
> = {
  2: { id: 1 },
  21: { id: 1, flags: { penthouse: true } },
  20: { id: 1, flags: { duplex: true } },
  // El 14 (Apartaestudio) exige `apartmentNumber`, que no tenemos: se publica
  // como apartamento marcado como estudio.
  14: { id: 1, flags: { studio: true } },
  1: { id: 2 },
  11: { id: 2, flags: { ruralZone: true } },
  10: { id: 2, flags: { chalet: true } },
  22: { id: 2 },
  19: { id: 2, flags: { houseType: 'Condominio' } },
  24: { id: 2, flags: { nearBeach: true } },
  28: { id: 2, flags: { cabin: true } },
  5: { id: 15 },
  6: { id: 15 },
  17: { id: 15 },
  3: { id: 6 },
  4: { id: 3 },
  15: { id: 5 },
  8: { id: 8 },
  23: { id: 8, flags: { warehouseType: 'Industrial' } },
  30: { id: 8, flags: { warehouseType: 'Industrial' } },
  7: { id: 7 },
  13: { id: 7 },
  27: { id: 7 },
  31: { id: 7 },
  16: { id: 9 },
};
const COMMERCIAL_TYPES = new Set([3, 5, 6, 8, 10]);

/** Nuestras caracteristicas → amenity de Metrocuadrado. Se filtran por las validas del tipo. */
const AMENITY_BY_FEATURE: Record<
  number,
  [string, string | boolean | number][]
> = {
  104: [['petsAllowed', true]],
  43: [['gateHouse', true]],
  48: [['surveillance', true]],
  6: [['auxiliaryBathroom', true]],
  72: [['nearbyPark', true]],
  44: [['elevator', true]],
  67: [['shoppingZone', true]],
  14: [['cytophone', true]],
  39: [['communityHall', true]],
  134: [['trashShut', true]],
  37: [['visitorParkingLot', true]],
  122: [['nearRestaurants', true]],
  40: [
    ['terraceOrBalcony', 'Terraza'],
    ['terrace', true],
  ],
  120: [['nearGardensAndSchools', true]],
  65: [['onMainStreet', true]],
  63: [['soccerField', true]],
  114: [['handicappedAccesible', true]],
  53: [['fruitTrees', true]],
  92: [['bbqArea', true]],
  62: [['basketballCourt', true]],
  7: [['studyOrLibrary', true]],
  105: [['view', 'Interior']],
  106: [['view', 'Exterior']],
  100: [['jacuzzi', true]],
  51: [['kiosk', true]],
  138: [['ParkingBays', true]],
  1: [['airConditioned', true]],
  18: [['auxiliaryDinningRoom', true]],
  136: [
    ['waterTanks', true],
    ['waterTank', true],
  ],
  129: [['walkingCloset', true]],
  31: [['golfCage', true]],
  128: [['dishwasher', true]],
  30: [['courtyard', true]],
  23: [['bodyguardRoom', true]],
  93: [['twoFamilyHome', true]],
  41: [['twoFamilyHome', true]],
  61: [['irrigationSystem', true]],
  4: [['furnished', true]],
  131: [['thermalControl', true]],
  130: [['noiseControl', true]],
  111: [['roofGarden', true]],
  59: [['manger', true]],
  56: [['stable', true]],
  52: [['nearARiverOrRavine', true]],
  139: [['smartParking', true]],
  71: [['nearbyPublicTransport', true]],
  73: [['nearbyShoppingCenter', true]],
  69: [['residentialZone', true]],
  46: [['closedComplex', true]],
  70: [['nearbySchoolCollege', true]],
  24: [['tiledFloor', true]],
  16: [['fullKitchen', true]],
  33: [['childrenArea', true]],
  11: [['panoramicView', true]],
  32: [['pool', true]],
  34: [['greenArea', true]],
  5: [['terraceOrBalcony', 'Balcón']],
  28: [['gym', true]],
  45: [['cctv', true]],
  123: [['nearNeighborhoodStores', true]],
  9: [['hall', true]],
  66: [['ruralZone', true]],
  15: [['americanKitchen', true]],
  17: [['americanKitchen', true]],
  8: [['serviceRoom', true]],
  21: [['deposits', 1]],
  29: [
    ['garden', true],
    ['gardens', true],
  ],
  10: [['sauna', true]],
  26: [['tennisCourt', true]],
  47: [
    ['electricPlant', true],
    ['electricPlant2', true],
  ],
  127: [['oven', true]],
  126: [['extractor', true]],
  135: [['solarEnergy', true]],
  25: [['squashCourt', true]],
  137: [['accessWithCardsOrDevices', true]],
  2: [['alarm', true]],
  22: [['pantry', true]],
  64: [['campingArea', true]],
  140: [['loft', true]],
  117: [
    ['securityDoors', true],
    ['securityDoor', true],
  ],
  68: [['industrialZone', true]],
  13: [['chimney', true]],
  132: [['SmokeDetection', true]],
  133: [['electricDoor', true]],
  124: [['lightInTheMorning', true]],
  125: [['lightInTheAfternoon', true]],
  58: [['greenhouse', true]],
  54: [['nativeForest', true]],
  108: [['woodenFloor', true]],
  110: [['buildingRating', 'Edificio inteligente']],
};
const FEATURE_REFORMADO = 97;

interface Amenity {
  amenity: string;
  required: boolean;
  restrictions?: string;
}

const CATALOG_TTL_MS = 24 * 3600_000;

@Injectable()
export class MetrocuadradoConnector implements PortalConnector {
  readonly key = ConnectorKey.METROCUADRADO;
  readonly mode = 'push' as const;
  readonly instructions =
    'Pide a tu asesor de Metrocuadrado los datos de INTEGRACION (no los de entrar al portal): API key, usuario, contrasena e identificacion.';
  readonly credentialFields: ConnectorField[] = [
    {
      key: 'apiKey',
      label: 'API key (x-api-key)',
      secret: true,
      required: true,
    },
    {
      key: 'username',
      label: 'Usuario de integracion',
      secret: true,
      required: true,
    },
    {
      key: 'password',
      label: 'Contrasena de integracion',
      secret: true,
      required: true,
    },
    {
      key: 'identification',
      label: 'Identificacion (NIT)',
      secret: true,
      required: true,
      help: 'Normalmente el NIT de la inmobiliaria. Confirmalo con Metrocuadrado (con o sin digito de verificacion).',
    },
  ];
  readonly settingFields: ConnectorField[] = [
    {
      key: 'integratorId',
      label: 'ID de integrador',
      secret: false,
      required: false,
    },
    {
      key: 'defaultAgentId',
      label: 'ID de agente por defecto',
      secret: false,
      required: false,
      help: 'Si el asesor del inmueble no existe en Metrocuadrado con el mismo correo, se usa este.',
    },
    {
      key: 'offerPreference',
      label: 'Si esta en venta y arriendo, publicar',
      secret: false,
      required: false,
      help: 'SALE (venta, por defecto) o RENT (arriendo).',
    },
    {
      key: 'regionId',
      label: 'Region de Metrocuadrado',
      secret: false,
      required: false,
      help: 'Santander es 26 (por defecto).',
    },
  ];

  private readonly tokens = new Map<string, { token: string; until: number }>();
  private readonly catalog = new Map<string, { at: number; data: unknown }>();

  // --- conexion -------------------------------------------------------------

  async test(ctx: ConnectorContext): Promise<string> {
    await this.token(ctx, true);
    const offices = this.unwrap<unknown[]>(
      await this.api(ctx, 'GET', '/rest-api/offices/'),
    );
    const agents = this.unwrap<unknown[]>(
      await this.api(ctx, 'GET', '/rest-api/agents/'),
    );
    return `Conectado. ${arr(offices).length} sucursales y ${arr(agents).length} agentes en Metrocuadrado.`;
  }

  async searchLocations(
    ctx: ConnectorContext,
    query: string,
    within?: { cityName: string; cityExternalId: string | null },
  ): Promise<RemoteLocation[]> {
    const region = ctx.settings.regionId || DEFAULT_REGION;
    // Sin ciudad emparejada, lo que se busca es la ciudad.
    if (!within?.cityExternalId) {
      const cities = arr<{ id: number; name: string }>(
        await this.cached(ctx, `cities:${region}`, () =>
          this.catalogue(ctx, `/rest-catalogue/cities/?regionId=${region}`),
        ),
      );
      const q = norm(query);
      return cities
        .filter((c) => norm(c.name).includes(q) || q.includes(norm(c.name)))
        .map((c) => ({
          id: String(c.id),
          name: c.name,
          type: 'CITY',
          city: null,
          state: null,
        }));
    }
    // Con ciudad: sus barrios. El buscador distingue tildes; el listado
    // completo de la ciudad (cientos) se filtra aqui, sin tildes.
    const cityId = within.cityExternalId;
    const hoods = arr<{ id: number; name: string; cityId: number }>(
      await this.cached(ctx, `hoods:${cityId}`, () =>
        this.catalogue(ctx, `/rest-catalogue/neighborhoods/?cityId=${cityId}`),
      ),
    );
    const q = norm(query);
    return hoods
      .filter((h) => norm(h.name).includes(q))
      .slice(0, 25)
      .map((h) => ({
        id: String(h.id),
        name: h.name,
        type: 'NEIGHBOURHOOD',
        city: within.cityName,
        state: null,
        extra: { cityId: String(cityId) },
      }));
  }

  // --- validar y traducir ---------------------------------------------------

  async validate(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): Promise<string[]> {
    const faltas: string[] = [];
    const type = TYPE[listing.propertyTypeId];
    if (!type)
      faltas.push(
        `Metrocuadrado no tiene equivalente para el tipo "${listing.propertyTypeName}"`,
      );
    if (listing.currency !== 'COP')
      faltas.push('Metrocuadrado solo acepta precios en pesos (COP)');
    const offer = this.offer(listing, ctx);
    if (!offer) faltas.push('Falta el precio de venta o de arriendo');
    else if (offer.price < 100_000)
      faltas.push('El precio es menor de $100.000');
    if (listing.images.length < 3)
      faltas.push(
        `Metrocuadrado pide al menos 3 fotos (tiene ${listing.images.length})`,
      );
    const city = this.city(listing, ctx);
    if (!city)
      faltas.push(
        `La ciudad "${listing.cityName}" no esta emparejada con Metrocuadrado`,
      );
    if (!listing.zoneName) faltas.push('Falta la zona (barrio)');
    if (!type || faltas.length) return faltas;

    const amenities = this.amenities(listing, type.flags);
    for (const def of await this.amenityDefs(ctx, type.id)) {
      if (def.required && amenities[def.amenity] === undefined) {
        faltas.push(
          `Falta un dato que Metrocuadrado exige: ${AMENITY_LABEL[def.amenity] ?? def.amenity}`,
        );
      }
    }
    return faltas;
  }

  private offer(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): { offer: 1 | 2; price: number } | null {
    const sale =
      listing.forSale && listing.salePrice
        ? { offer: 1 as const, price: listing.salePrice }
        : null;
    const rent =
      listing.forRent && listing.rentPrice
        ? { offer: 2 as const, price: listing.rentPrice }
        : null;
    return ctx.settings.offerPreference === 'RENT'
      ? (rent ?? sale)
      : (sale ?? rent);
  }

  /** Ciudad de Metrocuadrado: la de la ciudad emparejada o la que trae el barrio. */
  private city(listing: PortalListing, ctx: ConnectorContext): string | null {
    const loc = ctx.location(listing);
    if (!loc) return null;
    return loc.level === 'zone' ? (loc.extra.cityId ?? null) : loc.externalId;
  }

  private amenities(
    listing: PortalListing,
    flags: Record<string, string | boolean> = {},
  ) {
    const a: Record<string, string | number | boolean> = { ...flags };
    const features = listing.features.map((f) => f.id);
    a.builtTime = this.builtTime(listing, features);
    if (listing.bedrooms && listing.bedrooms > 0)
      a.rooms = listing.bedrooms >= 5 ? '5+' : String(listing.bedrooms);
    if (listing.bathrooms && listing.bathrooms > 0)
      a.bathrooms = String(Math.min(listing.bathrooms, 4));
    a.garages = listing.garages ?? 0;
    const built = listing.builtArea ?? listing.area;
    if (built) a.builtArea = built;
    const priv = listing.privateArea ?? listing.builtArea ?? listing.area;
    if (priv) a.area = priv;
    if (listing.area && built && listing.area > built) a.lotArea = listing.area;
    if (listing.floor && listing.floor >= 1 && listing.floor <= 999)
      a.floorNumber = listing.floor;
    for (const id of features) {
      for (const [key, value] of AMENITY_BY_FEATURE[id] ?? []) a[key] ??= value;
    }
    return a;
  }

  private builtTime(listing: PortalListing, features: number[]): string {
    if (features.includes(FEATURE_REFORMADO)) return 'Remodelado';
    if (listing.condition && listing.condition !== 'USED')
      return 'Entre 0 y 5 años';
    const years = listing.buildingYear
      ? new Date().getFullYear() - listing.buildingYear
      : 0;
    if (years <= 5) return 'Entre 0 y 5 años';
    if (years <= 10) return 'Entre 5 y 10 años';
    if (years <= 20) return 'Entre 10 y 20 años';
    return 'Más de 20 años';
  }

  private async payload(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const type = TYPE[listing.propertyTypeId];
    const offer = this.offer(listing, ctx)!;
    const loc = ctx.location(listing);

    // Solo las claves que el tipo admite: la API rechaza atributos desconocidos.
    const defs = await this.amenityDefs(ctx, type.id);
    const allowed = new Set(defs.map((d) => d.amenity));
    const amenities = Object.fromEntries(
      Object.entries(this.amenities(listing, type.flags)).filter(
        ([k]) => allowed.size === 0 || allowed.has(k),
      ),
    );

    const stratum =
      listing.stratum && listing.stratum >= 1 && listing.stratum <= 6
        ? listing.stratum
        : COMMERCIAL_TYPES.has(type.id)
          ? 7
          : undefined;
    const coords =
      listing.latitude != null && listing.longitude != null
        ? listing.showExactLocation
          ? { latitude: listing.latitude, longitude: listing.longitude }
          : {
              latitude: round(listing.latitude, 3),
              longitude: round(listing.longitude, 3),
            }
        : {};
    const agentId = await this.agentFor(listing, ctx);
    const extras = [
      listing.tourUrl ? `Recorrido 360: ${listing.tourUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return clean({
      realEstateType: type.id,
      realEstateOffer: offer.offer,
      price: Math.round(offer.price),
      administration:
        listing.maintenanceFee && listing.maintenanceFee >= 10_000
          ? Math.round(listing.maintenanceFee)
          : undefined,
      city: Number(this.city(listing, ctx)),
      neighborhood:
        loc?.level === 'zone'
          ? loc.externalName.split(',')[0]
          : listing.zoneName,
      neighborhoodId:
        loc?.level === 'zone' ? Number(loc.externalId) : undefined,
      stratum,
      address: listing.showExactLocation
        ? (listing.address ?? undefined)
        : undefined,
      ...coords,
      reference1: listing.code,
      agentId,
      comments: clip(
        `${listing.title}\n\n${listing.description}${extras ? `\n\n${extras}` : ''}`,
        1000,
      ),
      video:
        listing.videoUrl && /^https?:\/\//.test(listing.videoUrl)
          ? listing.videoUrl
          : undefined,
      images: listing.images.slice(0, 20),
      amenities,
      integratorId: ctx.settings.integratorId
        ? Number(ctx.settings.integratorId)
        : undefined,
      responseUrl: ctx.callbackUrl,
    });
  }

  /** El agente de Metrocuadrado con el mismo correo que el asesor, o el de por defecto. */
  private async agentFor(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): Promise<number | undefined> {
    const email = listing.agent?.email?.toLowerCase();
    if (email) {
      const agents = arr<{ id: number; email?: string }>(
        await this.cached(
          ctx,
          'agents',
          async () =>
            this.unwrap(await this.api(ctx, 'GET', '/rest-api/agents/')),
          3600_000,
        ),
      );
      const match = agents.find((a) => a.email?.toLowerCase() === email);
      if (match) return Number(match.id);
    }
    return ctx.settings.defaultAgentId
      ? Number(ctx.settings.defaultAgentId)
      : undefined;
  }

  // --- operaciones -------------------------------------------------------------

  async upsert(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome> {
    // Publicar es asincrono y no devuelve el id: mientras una publicacion siga
    // en curso sin id, volver a publicar crearia un duplicado.
    if (!ref.externalId && ref.transactionId?.startsWith('publish:')) {
      const done = await this.poll(ctx, ref);
      if (!done || done.state === PublicationState.PENDING) {
        return (
          done ?? {
            state: PublicationState.PENDING,
            transactionId: ref.transactionId,
          }
        );
      }
      if (!done.externalId) return done;
      ref = { ...ref, externalId: done.externalId };
    }

    const body = await this.payload(listing, ctx);
    if (ref.externalId) {
      try {
        const res = this.unwrap<{ transactionId?: string }>(
          await this.api(ctx, 'PUT', '/rest-api/realestate/update', {
            ...body,
            realEstateId: ref.externalId,
          }),
        );
        return {
          state: PublicationState.PENDING,
          externalId: ref.externalId,
          transactionId: `update:${res?.transactionId ?? ''}`,
          note: 'Actualizacion enviada; Metrocuadrado la esta procesando',
        };
      } catch (err) {
        // El aviso ya no existe alli: se publica de nuevo.
        if (!(err instanceof PortalRejection && /\b404\b/.test(err.message)))
          throw err;
      }
    }
    const res = this.unwrap<{ transactionId?: string }>(
      await this.api(ctx, 'POST', '/rest-api/realestate/publish', body),
    );
    if (!res?.transactionId)
      throw new PortalTransientError(
        'Metrocuadrado no devolvio la transaccion',
      );
    return {
      state: PublicationState.PENDING,
      externalId: null,
      transactionId: `publish:${res.transactionId}`,
      note: 'Enviado; Metrocuadrado lo esta procesando',
    };
  }

  async remove(
    ctx: ConnectorContext,
    _listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome> {
    if (!ref.externalId)
      return {
        state: PublicationState.REMOVED,
        note: 'No habia aviso nuestro en Metrocuadrado',
      };
    try {
      const res = this.unwrap<{ transactionId?: string }>(
        await this.api(ctx, 'PATCH', '/rest-api/realestate/unpublish', {
          realEstateId: ref.externalId,
          responseUrl: ctx.callbackUrl,
        }),
      );
      return res?.transactionId
        ? {
            state: PublicationState.PENDING,
            transactionId: `unpublish:${res.transactionId}`,
            note: 'Retirando de Metrocuadrado',
          }
        : {
            state: PublicationState.REMOVED,
            note: 'Despublicado en Metrocuadrado',
          };
    } catch (err) {
      if (err instanceof PortalRejection && /\b404\b/.test(err.message)) {
        return {
          state: PublicationState.REMOVED,
          note: 'Ya no estaba en Metrocuadrado',
        };
      }
      throw err;
    }
  }

  async poll(
    ctx: ConnectorContext,
    ref: RemoteRef,
  ): Promise<SyncOutcome | null> {
    const [op, id] = splitTx(ref.transactionId);
    if (!id) return null;
    let body: unknown;
    try {
      body = this.unwrap(
        await this.api(ctx, 'GET', `/rest-api/transactions/${id}`),
      );
    } catch (err) {
      if (err instanceof PortalRejection && /\b404\b/.test(err.message))
        return null;
      throw err;
    }
    return this.interpret(op, body, ref);
  }

  handleCallback(
    _ctx: ConnectorContext,
    body: unknown,
  ): Promise<
    { transactionId?: string; reference?: string; outcome?: SyncOutcome }[]
  > {
    const data = unwrapAny(body);
    const transactionId = pick(data, [
      'transactionId',
      'transaction_id',
      'idTransaction',
    ]);
    const reference = pick(data, ['reference1', 'reference']);
    if (!transactionId && !reference) return Promise.resolve([]);
    // La operacion no viaja en el callback: se deja que `poll` —que si la
    // conoce por el prefijo guardado— decida, salvo que ya venga resuelto.
    const outcome = this.interpret(null, data, {
      externalId: null,
      transactionId: null,
    });
    return Promise.resolve([
      { transactionId, reference, outcome: outcome ?? undefined },
    ]);
  }

  /**
   * Lee un resultado de Metrocuadrado (callback o transaccion). El formato no
   * esta documentado: se prueban los nombres de campo razonables y, si no se
   * reconoce nada, se devuelve `null` (sigue pendiente) en lugar de adivinar.
   */
  private interpret(
    op: string | null,
    raw: unknown,
    ref: RemoteRef,
  ): SyncOutcome | null {
    const data = unwrapAny(raw);
    const externalId = pick(data, [
      'realEstateId',
      'realestateId',
      'propertyId',
      'idInmueble',
    ]);
    const validId =
      externalId && /^\d+-M\d+$/.test(externalId) ? externalId : undefined;
    const status = pick(data, ['status', 'state', 'estado']) ?? '';
    const code = Number(
      pick(data, ['code', 'statusCode', 'responseCode', 'httpCode']),
    );
    const message =
      pick(data, ['message', 'response', 'error', 'detail']) ?? '';
    const url = pick(data, ['url', 'link', 'publicUrl', 'realEstateUrl']);

    const failed =
      (code >= 400 && code < 600) || /error|fail|reject|rechaz/i.test(status);
    if (failed)
      return {
        state: PublicationState.REJECTED,
        note: clip(message || status || 'Rechazado por Metrocuadrado', 300),
      };

    const ok =
      [200, 201, 1000].includes(code) ||
      /success|ok|complet|publicad|published|exitos/i.test(status) ||
      Boolean(validId);
    if (!ok) return null;
    if (op === 'unpublish')
      return {
        state: PublicationState.REMOVED,
        note: 'Despublicado en Metrocuadrado',
      };
    const id = validId ?? ref.externalId ?? undefined;
    return {
      state: PublicationState.PUBLISHED,
      ...(id ? { externalId: id } : {}),
      ...(url && /^https?:\/\//.test(url) ? { externalUrl: url } : {}),
      note: id
        ? null
        : 'Publicado; Metrocuadrado aun no informo el codigo del aviso',
    };
  }

  // --- HTTP --------------------------------------------------------------------

  private hosts(ctx: ConnectorContext) {
    return ctx.sandbox ? HOSTS.dev : HOSTS.production;
  }

  private async token(ctx: ConnectorContext, force = false): Promise<string> {
    const key = `${ctx.portalId}:${ctx.sandbox}`;
    const cached = this.tokens.get(key);
    if (!force && cached && cached.until > Date.now() + 60_000)
      return cached.token;
    const { apiKey, username, password, identification } = ctx.credentials;
    if (!apiKey || !username || !password || !identification) {
      throw new PortalConfigError('Faltan credenciales de Metrocuadrado');
    }
    let res: { data?: { id_token?: string; expires_in?: number } };
    try {
      res = await portalFetch(
        NAME,
        `${this.hosts(ctx).token}/v1/api/core/oauth2/tokens`,
        {
          method: 'POST',
          headers: { 'x-api-key': apiKey },
          body: { username, password, identification },
        },
      );
    } catch (err) {
      if (err instanceof PortalRejection && /\b(406|403)\b/.test(err.message)) {
        throw new PortalConfigError(
          `Metrocuadrado rechazo las credenciales: ${err.message}`,
        );
      }
      throw err;
    }
    const token = res?.data?.id_token;
    if (!token)
      throw new PortalConfigError('Metrocuadrado no devolvio un token');
    this.tokens.set(key, {
      token,
      until: Date.now() + (res.data?.expires_in ?? 3600) * 1000,
    });
    return token;
  }

  /**
   * Un recurso protegido. Sin token valido Metrocuadrado responde 200 con una
   * pagina HTML, no 401: una respuesta que no es JSON se trata como token
   * caducado y se reintenta una vez con uno nuevo.
   */
  private async api(
    ctx: ConnectorContext,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(ctx, attempt > 0);
      try {
        const res = await portalFetch<unknown>(
          NAME,
          `${this.hosts(ctx).res}${path}`,
          {
            method,
            headers: { 'x-api-key': ctx.credentials.apiKey, token },
            body,
            timeoutMs: 60_000,
          },
        );
        if (typeof res === 'string' && /<html/i.test(res)) {
          if (attempt === 0) continue;
          throw new PortalConfigError(
            'Metrocuadrado no acepto el token (respondio una pagina HTML)',
          );
        }
        return res;
      } catch (err) {
        if (err instanceof PortalConfigError && attempt === 0) continue;
        if (err instanceof PortalRejection && /\b409\b/.test(err.message)) {
          throw new PortalRejection(
            `Sin cupos en Metrocuadrado: ${err.message}`,
          );
        }
        throw err;
      }
    }
    throw new PortalTransientError('Metrocuadrado no respondio');
  }

  private catalogue(ctx: ConnectorContext, path: string): Promise<unknown> {
    return portalFetch(NAME, `${this.hosts(ctx).res}${path}`, {
      headers: { 'x-api-key': ctx.credentials.apiKey },
    }).then((r) => this.unwrap(r));
  }

  private async cached<T>(
    ctx: ConnectorContext,
    key: string,
    load: () => Promise<T>,
    ttl = CATALOG_TTL_MS,
  ): Promise<T> {
    const k = `${ctx.portalId}:${ctx.sandbox}:${key}`;
    const hit = this.catalog.get(k);
    if (hit && Date.now() - hit.at < ttl) return hit.data as T;
    const data = await load();
    this.catalog.set(k, { at: Date.now(), data });
    return data;
  }

  private async amenityDefs(
    ctx: ConnectorContext,
    typeId: number,
  ): Promise<Amenity[]> {
    return arr<Amenity>(
      await this.cached(ctx, `amenities:${typeId}`, () =>
        this.catalogue(
          ctx,
          `/rest-catalogue/amenities/?realEstateType=${typeId}`,
        ),
      ),
    );
  }

  private unwrap<T>(body: unknown): T {
    if (Array.isArray(body)) return body as T;
    if (body && typeof body === 'object' && 'data' in body)
      return (body as { data: T }).data;
    return body as T;
  }
}

/** Lo que el panel muestra cuando falta un amenity obligatorio. */
const AMENITY_LABEL: Record<string, string> = {
  builtTime: 'antiguedad (año de construccion)',
  rooms: 'numero de alcobas',
  bathrooms: 'numero de baños',
  garages: 'numero de garajes',
  builtArea: 'area construida',
  area: 'area privada',
  apartmentNumber: 'numero de apartamento',
};

function arr<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Sin HTML, sin controles y sin cortar una palabra. */
function clip(text: string, max: number): string {
  const plain = stripControl(text.replace(/<[^>]+>/g, ' ')).trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.8 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

/** Metrocuadrado pide omitir los opcionales, nunca mandarlos nulos o vacios. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, v]) => v !== undefined && v !== null && v !== '' && !Number.isNaN(v),
    ),
  );
}

function splitTx(tx: string | null): [string | null, string | null] {
  if (!tx) return [null, null];
  const i = tx.indexOf(':');
  return i < 0 ? [null, tx] : [tx.slice(0, i), tx.slice(i + 1) || null];
}

function unwrapAny(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const inner =
    b.data && typeof b.data === 'object' && !Array.isArray(b.data)
      ? (b.data as Record<string, unknown>)
      : null;
  return inner ? { ...b, ...inner } : b;
}

function pick(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v) && v.length) return JSON.stringify(v).slice(0, 300);
  }
  return undefined;
}
