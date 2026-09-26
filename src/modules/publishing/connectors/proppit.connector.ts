import { Injectable } from '@nestjs/common';
import { ConnectorKey } from '../domain/portal-connection.entity';
import { PublicationState } from '../domain/property-publication.entity';
import {
  PortalConfigError,
  PortalRejection,
  type ConnectorContext,
  type ConnectorField,
  type PortalConnector,
  type RemoteRef,
  type SyncOutcome,
} from '../sync/connector';
import { portalFetch } from '../sync/http';
import type { PortalListing } from '../sync/listing';

/**
 * Proppit (LIFULL Connect) — Real-Time API v2. Un anuncio aqui sale en
 * Properati, puntopropiedad, Trovit, Mitula, Nestoria y Nuroa.
 *
 *  - Token de `POST /token` con usuario y clave de integrador.
 *  - La inmobiliaria es un "publisher" con un id que elegimos nosotros (el
 *    correo de la cuenta Proppit, en minusculas) y que Proppit aprueba a mano.
 *  - Crear y actualizar son sincronos, pero un 201 no garantiza que se vea:
 *    solo el `status` del GET lo dice, y tarda unos minutos. De ahi el
 *    `check:<referenceId>` que queda en la cola hasta confirmar.
 */
const BASE = 'https://real-time.proppit.com/api/v2';
const COUNTRY = 'CO';
const LOCALE = 'es-CO';
const NAME = 'Proppit';

/** Nuestro tipo (ids de WASI) → tipo de Proppit en Colombia. */
const TYPE: Record<number, string> = {
  2: 'apartment',
  21: 'apartment',
  20: 'apartment',
  25: 'apartment',
  14: 'studio',
  1: 'house',
  10: 'house',
  19: 'house',
  22: 'house',
  24: 'house',
  11: 'villa',
  7: 'villa',
  28: 'villa',
  31: 'villa',
  27: 'villa',
  13: 'villa',
  5: 'land',
  6: 'land',
  17: 'land',
  32: 'land',
  29: 'land',
  3: 'commercial',
  12: 'commercial',
  18: 'commercial',
  16: 'commercial',
  4: 'office',
  15: 'office',
  8: 'industrial unit',
  30: 'industrial unit',
  23: 'industrial unit',
  26: 'car park',
};
/** Tipos sin alcobas ni baños segun las reglas de Colombia. */
const NO_BEDROOMS = new Set([
  'land',
  'commercial',
  'industrial unit',
  'car park',
]);
const NO_BATHROOMS = new Set(['land', 'industrial unit', 'car park']);
/** Donde `area` es terreno y va aparte, en `totalArea`. */
const HAS_PLOT = new Set(['land', 'house', 'villa', 'industrial unit']);

const AMENITY_BY_FEATURE: Record<number, string> = {
  1: 'air conditioning',
  2: 'alarm',
  5: 'balcony',
  35: 'car park',
  55: 'car park',
  37: 'car park',
  138: 'car park',
  33: "children's area",
  114: 'disabled access',
  85: 'equipped kitchen',
  16: 'equipped kitchen',
  13: 'fireplace',
  29: 'garden',
  34: 'garden',
  92: 'grill',
  28: 'gym',
  43: 'guardhouse',
  80: 'guardhouse',
  113: 'internet',
  100: 'jacuzzi',
  44: 'lift',
  19: 'natural gas',
  11: 'panoramic view',
  10: 'sauna',
  99: 'sauna',
  48: 'security',
  45: 'security',
  8: 'service room',
  32: 'swimming pool',
  26: 'tennis court',
  40: 'terrace',
  116: 'water',
  136: 'water tank',
  30: 'yard',
  118: 'electricity',
};
const NEARBY_BY_FEATURE: Record<number, string> = {
  72: 'park',
  70: 'schools',
  120: 'schools',
  73: 'shopping mall',
  65: 'main street',
  75: 'sea',
};
const FEATURE_FURNISHED = 4;
const FEATURE_PETS = 104;

interface TypeCatalog {
  id: string;
  amenities?: string[];
  nearbyLocations?: string[];
  rules?: string[];
}

@Injectable()
export class ProppitConnector implements PortalConnector {
  readonly key = ConnectorKey.PROPPIT;
  readonly mode = 'push' as const;
  readonly instructions =
    'Pide a Proppit (ingester@lifullconnect.com) usuario y clave de la Real-Time API para Colombia, y que aprueben el publisher de Serrano vinculado a tu plan.';
  readonly credentialFields: ConnectorField[] = [
    { key: 'user', label: 'Usuario de la API', secret: true, required: true },
    { key: 'password', label: 'Clave de la API', secret: true, required: true },
  ];
  readonly settingFields: ConnectorField[] = [
    {
      key: 'publisherId',
      label: 'ID de publisher',
      secret: false,
      required: true,
      help: 'El correo de tu cuenta Proppit, en minusculas. No lo cambies despues: los anuncios cuelgan de el.',
    },
    {
      key: 'publisherName',
      label: 'Nombre comercial',
      secret: false,
      required: false,
    },
    {
      key: 'contactEmail',
      label: 'Correo de contacto (si no, el del asesor)',
      secret: false,
      required: false,
    },
    {
      key: 'contactPhone',
      label: 'Telefono de contacto (si no, el del asesor)',
      secret: false,
      required: false,
    },
  ];

  private readonly tokens = new Map<string, { token: string; until: number }>();
  private types: { at: number; byId: Map<string, TypeCatalog> } | null = null;

  // --- conexion -------------------------------------------------------------

  /**
   * Comprueba credenciales y, si el publisher no existe, lo crea. La
   * aprobacion la hace Proppit a mano: mientras tanto los anuncios se guardan
   * pero no se ven.
   */
  async test(ctx: ConnectorContext): Promise<string> {
    await this.token(ctx, true);
    const id = this.publisherId(ctx);
    let publisher: { publishingEnabled?: boolean };
    try {
      publisher = await this.api(
        ctx,
        'GET',
        `/proppit/${COUNTRY}/publishers/${encodeURIComponent(id)}`,
      );
    } catch (err) {
      if (!(err instanceof PortalRejection && /\b404\b/.test(err.message)))
        throw err;
      publisher = await this.api(
        ctx,
        'POST',
        `/proppit/${COUNTRY}/publishers`,
        {
          id,
          name: ctx.settings.publisherName || 'Serrano Inmobiliaria',
          email: id.includes('@') ? id : ctx.settings.contactEmail,
          phone: this.phone(ctx.settings.contactPhone) ?? undefined,
        },
      );
    }
    return publisher.publishingEnabled
      ? `Conectado. Publisher ${id} aprobado: los anuncios se publican.`
      : `Conectado. Publisher ${id} creado pero PENDIENTE de aprobacion por Proppit: los anuncios se guardan sin mostrarse hasta que lo aprueben.`;
  }

  // --- validar y traducir ---------------------------------------------------

  validate(listing: PortalListing): string[] {
    const faltas: string[] = [];
    const type = TYPE[listing.propertyTypeId];
    if (!type)
      faltas.push(
        `Proppit no tiene equivalente para el tipo "${listing.propertyTypeName}"`,
      );
    if (!this.operations(listing).length)
      faltas.push('Falta el precio de venta o de arriendo');
    if (!listing.description) faltas.push('Falta la descripcion');
    const hasCoords =
      listing.latitude != null &&
      listing.longitude != null &&
      (listing.latitude !== 0 || listing.longitude !== 0);
    if (!hasCoords && !listing.address)
      faltas.push('Faltan la direccion y las coordenadas');
    if (
      type === 'land'
        ? !listing.area
        : !(listing.privateArea ?? listing.builtArea ?? listing.area)
    ) {
      faltas.push('Falta el area');
    }
    return faltas;
  }

  private operations(listing: PortalListing) {
    const ops: {
      type: 'sell' | 'rent';
      price: { value: number; currency: string };
    }[] = [];
    if (listing.forSale && listing.salePrice) {
      ops.push({
        type: 'sell',
        price: {
          value: Math.round(listing.salePrice),
          currency: listing.currency,
        },
      });
    }
    if (listing.forRent && listing.rentPrice) {
      ops.push({
        type: 'rent',
        price: {
          value: Math.round(listing.rentPrice),
          currency: listing.currency,
        },
      });
    }
    return ops;
  }

  private async payload(
    ctx: ConnectorContext,
    listing: PortalListing,
  ): Promise<Record<string, unknown>> {
    const type = TYPE[listing.propertyTypeId];
    const catalog = (await this.catalog(ctx)).get(type);
    const features = listing.features.map((f) => f.id);
    const only = (values: string[], allowed?: string[]) =>
      [...new Set(values)].filter((v) => !allowed || allowed.includes(v));

    const amenities = only(
      features.map((id) => AMENITY_BY_FEATURE[id]).filter(Boolean),
      catalog?.amenities,
    );
    const nearby = only(
      features.map((id) => NEARBY_BY_FEATURE[id]).filter(Boolean),
      catalog?.nearbyLocations,
    );
    const rules =
      listing.forRent &&
      ['house', 'apartment', 'villa'].includes(type) &&
      features.includes(FEATURE_PETS)
        ? only(['pets allowed'], catalog?.rules)
        : [];

    const hasCoords =
      listing.latitude != null &&
      listing.longitude != null &&
      (listing.latitude !== 0 || listing.longitude !== 0);
    const floorArea = listing.privateArea ?? listing.builtArea ?? listing.area;
    const built = listing.builtArea ?? listing.privateArea;
    const plot =
      HAS_PLOT.has(type) && listing.area && (!built || listing.area > built)
        ? listing.area
        : null;
    const email = ctx.settings.contactEmail || listing.agent?.email;
    const phone = this.phone(ctx.settings.contactPhone || listing.agent?.phone);
    const whatsapp = !ctx.settings.contactPhone
      ? this.phone(listing.agent?.whatsapp)
      : null;

    return compact({
      referenceId: listing.code,
      publisher: { externalId: this.publisherId(ctx) },
      contact: email
        ? compact({
            name:
              listing.agent?.name ||
              ctx.settings.publisherName ||
              'Serrano Inmobiliaria',
            email,
            phone,
            whatsapp,
          })
        : undefined,
      property: compact({
        type,
        location: compact({
          countryCode: COUNTRY,
          visibility: listing.showExactLocation ? 'accurate' : 'approximate',
          coordinates: hasCoords
            ? { lat: listing.latitude, long: listing.longitude }
            : undefined,
          address: [
            listing.address,
            listing.zoneName,
            listing.cityName,
            listing.regionName,
            'Colombia',
          ]
            .filter(Boolean)
            .join(', '),
          nearbyLocations: nearby.length ? nearby : undefined,
        }),
        communityFees: listing.maintenanceFee
          ? {
              value: Math.round(listing.maintenanceFee),
              currency: listing.currency,
            }
          : undefined,
        floor: listing.floor != null ? String(listing.floor) : undefined,
      }),
      operations: this.operations(listing),
      title: { locale: LOCALE, text: sentenceCase(listing.title) },
      description: {
        locale: LOCALE,
        text: listing.description.replace(/<[^>]+>/g, ' ').trim(),
      },
      multimedia: compact({
        pictures: listing.images.slice(0, 200).map((url) => ({ url })),
        videos: listing.videoUrl ? [{ url: listing.videoUrl }] : undefined,
        virtualTours: listing.tourUrl ? [{ url: listing.tourUrl }] : undefined,
      }),
      floorArea:
        type !== 'land' && floorArea
          ? { value: floorArea, unit: 'sqm' }
          : undefined,
      usableArea:
        type !== 'land' && listing.builtArea
          ? { value: listing.builtArea, unit: 'sqm' }
          : undefined,
      totalArea:
        type === 'land'
          ? { value: listing.area, unit: 'sqm' }
          : plot
            ? { value: plot, unit: 'sqm' }
            : undefined,
      isBoosted: listing.outstanding,
      isExclusive: false,
      bedrooms: NO_BEDROOMS.has(type)
        ? 0
        : Math.max(1, Math.round(listing.bedrooms ?? 1)),
      bathrooms: NO_BATHROOMS.has(type)
        ? 0
        : Math.max(1, Math.round(listing.bathrooms ?? 1)),
      stratum:
        listing.stratum && listing.stratum >= 1 && listing.stratum <= 7
          ? listing.stratum
          : undefined,
      parkingSpaces: listing.garages ?? undefined,
      constructionYear:
        listing.buildingYear &&
        listing.buildingYear >= 1500 &&
        listing.buildingYear <= 2100
          ? listing.buildingYear
          : undefined,
      condition:
        listing.condition === 'NEW'
          ? 'new'
          : listing.condition === 'USED' || !listing.condition
            ? 'second hand'
            : 'in construction',
      furnished: features.includes(FEATURE_FURNISHED) ? 'fully' : undefined,
      amenities,
      rules,
    });
  }

  // --- operaciones -------------------------------------------------------------

  async upsert(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome> {
    const body = await this.payload(ctx, listing);
    const path = `/proppit/${COUNTRY}/ads`;
    const put = () =>
      this.api(ctx, 'PUT', `${path}/${encodeURIComponent(listing.code)}`, body);

    try {
      if (ref.externalId) await put();
      else await this.api(ctx, 'POST', path, body);
    } catch (err) {
      if (!(err instanceof PortalRejection)) throw err;
      if (/already exists/i.test(err.message)) await put();
      else if (/\b404\b/.test(err.message) && ref.externalId)
        await this.api(ctx, 'POST', path, body);
      else throw err;
    }
    return {
      state: PublicationState.PENDING,
      externalId: listing.code,
      transactionId: `check:${listing.code}`,
      note: 'Recibido por Proppit; comprobando que se publique',
    };
  }

  async remove(
    ctx: ConnectorContext,
    listing: PortalListing,
  ): Promise<SyncOutcome> {
    try {
      await this.api(
        ctx,
        'DELETE',
        `/proppit/${COUNTRY}/ads/${encodeURIComponent(listing.code)}?externalId=${encodeURIComponent(this.publisherId(ctx))}`,
      );
    } catch (err) {
      if (!(err instanceof PortalRejection && /\b404\b/.test(err.message)))
        throw err;
    }
    return { state: PublicationState.REMOVED, note: 'Retirado de Proppit' };
  }

  async poll(
    ctx: ConnectorContext,
    ref: RemoteRef,
  ): Promise<SyncOutcome | null> {
    const code = ref.transactionId?.replace(/^check:/, '') ?? ref.externalId;
    if (!code) return null;
    let ad: { status?: string };
    try {
      ad = await this.api(
        ctx,
        'GET',
        `/proppit/${COUNTRY}/ads/${encodeURIComponent(code)}?externalId=${encodeURIComponent(this.publisherId(ctx))}`,
      );
    } catch (err) {
      if (err instanceof PortalRejection && /not processed/i.test(err.message))
        return null;
      if (err instanceof PortalRejection && /\b404\b/.test(err.message)) {
        return {
          state: PublicationState.REJECTED,
          note: 'Proppit no llego a crear el anuncio; vuelve a enviarlo',
        };
      }
      throw err;
    }
    if (ad.status === 'published')
      return {
        state: PublicationState.PUBLISHED,
        externalId: code,
        note: null,
      };
    if (ad.status === 'unpublished') {
      return {
        state: PublicationState.PAUSED,
        externalId: code,
        note: 'Proppit lo tiene pero no lo muestra: publisher sin aprobar o plan sin cupo',
      };
    }
    return null;
  }

  // --- HTTP --------------------------------------------------------------------

  private publisherId(ctx: ConnectorContext): string {
    const id = ctx.settings.publisherId?.trim().toLowerCase();
    if (!id) throw new PortalConfigError('Falta el ID de publisher de Proppit');
    return id;
  }

  private phone(raw: string | null | undefined): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.length === 10 ? `+57${digits}` : `+${digits}`;
  }

  private async token(ctx: ConnectorContext, force = false): Promise<string> {
    const key = `${ctx.portalId}`;
    const cached = this.tokens.get(key);
    if (!force && cached && cached.until > Date.now() + 60_000)
      return cached.token;
    const { user, password } = ctx.credentials;
    if (!user || !password)
      throw new PortalConfigError('Faltan el usuario y la clave de Proppit');
    const res = await portalFetch<{ token?: string; expiration?: number }>(
      NAME,
      `${BASE}/token`,
      {
        method: 'POST',
        body: { user, password },
      },
    );
    if (!res?.token)
      throw new PortalConfigError('Proppit no devolvio un token');
    // `expiration` es el instante en que caduca, en segundos Unix.
    this.tokens.set(key, {
      token: res.token,
      until: (res.expiration ?? Date.now() / 1000 + 3000) * 1000,
    });
    return res.token;
  }

  private async api<T = any>(
    ctx: ConnectorContext,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(ctx, attempt > 0);
      try {
        return await portalFetch<T>(NAME, `${BASE}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
          body,
          timeoutMs: 60_000,
        });
      } catch (err) {
        // Token caducado antes de tiempo: uno nuevo y otra vez, solo una.
        if (err instanceof PortalConfigError && attempt === 0) continue;
        if (err instanceof PortalRejection && /\b403\b/.test(err.message)) {
          throw new PortalConfigError(
            `Proppit no deja publicar con este publisher: ${err.message}`,
          );
        }
        throw err;
      }
    }
  }

  /** Amenities, cercanias y reglas validas por tipo. Un valor fuera de lista descarta el anuncio. */
  private async catalog(
    ctx: ConnectorContext,
  ): Promise<Map<string, TypeCatalog>> {
    if (this.types && Date.now() - this.types.at < 24 * 3600_000)
      return this.types.byId;
    try {
      const rows = await this.api<TypeCatalog[]>(
        ctx,
        'GET',
        `/proppit/${COUNTRY}/property-types`,
      );
      this.types = {
        at: Date.now(),
        byId: new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r])),
      };
    } catch {
      // Sin catalogo se envia igual; es preferible a no publicar.
      this.types = { at: Date.now() - 23 * 3600_000, byId: new Map() };
    }
    return this.types.byId;
  }
}

/** Los titulos de WASI estan en MAYUSCULAS: en Proppit se leen como gritos. */
function sentenceCase(text: string): string {
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Fuera lo `undefined`: Proppit valida tipos y un nulo cuenta como valor. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  ) as T;
}
