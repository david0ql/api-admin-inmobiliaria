import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
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

/**
 * Fincaraiz — "Fincaraiz API: Integration Partners" v1.0.0.
 *
 * Tres cosas que marcan todo el conector:
 *
 *  1. Todo es asincrono: crear o actualizar devuelve una TAREA, no el aviso.
 *     El resultado llega por webhook o preguntando por la tarea.
 *  2. Crear no publica: el aviso nace "Pendiente" y hay que activarlo aparte.
 *     Si no queda cupo, se queda en NO_QUOTA.
 *  3. Actualizar es reemplazo completo: se manda el aviso entero, y ni la
 *     oferta ni el tipo se pueden cambiar despues de creado.
 *
 * De ahi las etapas que viajan en `transactionId`:
 *   create:<tarea>   → al terminar, se activa        → activate:<tarea>
 *   activate:<tarea> → al terminar, se mira el aviso → confirm:<listing_id>
 *   update:<tarea>   → al terminar, se mira el aviso → confirm:<listing_id>
 *   confirm:<id>     → hasta que el aviso este activo (4) o falle
 */
const BASE = {
  production: 'https://msi-infofinca.fincaraiz.com.co/management/api/1.0',
  qa: 'https://api-integrators.frcol.io/management/api/1.0',
};
const NAME = 'Fincaraiz';

/** Nuestro `property_type` (ids de WASI) → tipo de Fincaraiz y categoria extra. */
const PROPERTY_TYPE: Record<
  number,
  { type: string; category?: number; interiorFloors?: number }
> = {
  1: { type: 'house' },
  2: { type: 'apartment' },
  3: { type: 'commercial' },
  4: { type: 'office' },
  5: { type: 'lot' },
  6: { type: 'lot', category: 137 },
  7: { type: 'farm' },
  8: { type: 'warehouse' },
  10: { type: 'house' },
  11: { type: 'country-house' },
  12: { type: 'building' },
  13: { type: 'farm' },
  14: { type: 'studio' },
  15: { type: 'consulting-room' },
  16: { type: 'building' },
  17: { type: 'lot' },
  18: { type: 'building' },
  19: { type: 'house', category: 246 },
  20: { type: 'apartment', category: 144, interiorFloors: 2 },
  21: { type: 'apartment', category: 146 },
  22: { type: 'house' },
  23: { type: 'warehouse', category: 170 },
  24: { type: 'house' },
  26: { type: 'parking' },
  27: { type: 'farm' },
  28: { type: 'cabin' },
  30: { type: 'warehouse' },
  31: { type: 'farm' },
};

/** Para montar la URL publica del aviso: la web resuelve por el numero final. */
const TYPE_SLUG: Record<string, string> = {
  lot: 'lote',
  commercial: 'local',
  office: 'oficina',
  warehouse: 'bodega',
  farm: 'finca',
  apartment: 'apartamento',
  house: 'casa',
  room: 'habitacion',
  'consulting-room': 'consultorio',
  building: 'edificio',
  cabin: 'cabana',
  'country-house': 'casa-campestre',
  studio: 'apartaestudio',
  'house-lot': 'casa-lote',
  parking: 'parqueadero',
};

/** Nuestras caracteristicas → categorias de Fincaraiz. Lo que no esta, se descarta. */
const CATEGORY_BY_FEATURE: Record<number, number> = {
  1: 1,
  2: 120,
  4: 19,
  5: 32,
  6: 121,
  7: 122,
  8: 123,
  9: 124,
  10: 125,
  11: 126,
  12: 128,
  13: 129,
  14: 130,
  15: 127,
  16: 20,
  17: 131,
  18: 132,
  19: 133,
  20: 134,
  21: 11,
  22: 155,
  23: 154,
  24: 4,
  25: 100,
  26: 101,
  27: 102,
  28: 103,
  29: 7,
  30: 16,
  31: 104,
  32: 17,
  33: 106,
  34: 107,
  35: 109,
  36: 110,
  37: 5,
  38: 111,
  39: 112,
  40: 10,
  41: 113,
  42: 114,
  43: 115,
  44: 13,
  45: 117,
  46: 12,
  47: 118,
  48: 119,
  49: 156,
  50: 159,
  51: 169,
  52: 158,
  53: 160,
  54: 161,
  55: 171,
  56: 173,
  57: 170,
  58: 172,
  59: 165,
  60: 166,
  61: 167,
  62: 162,
  63: 163,
  64: 168,
  65: 135,
  66: 136,
  67: 137,
  68: 138,
  69: 139,
  70: 140,
  71: 141,
  72: 142,
  73: 143,
  78: 112,
  80: 157,
  84: 180,
  85: 174,
  88: 225,
  90: 11,
  91: 102,
  92: 177,
  93: 113,
  95: 114,
  98: 180,
  99: 125,
  100: 125,
  102: 225,
  103: 11,
  105: 326,
  106: 327,
  107: 217,
  108: 217,
  110: 206,
  113: 190,
  115: 112,
  116: 175,
  117: 218,
  118: 175,
  120: 140,
  121: 258,
  122: 259,
  123: 202,
  129: 180,
  130: 254,
  131: 255,
  132: 212,
  133: 152,
  134: 222,
  136: 150,
  137: 253,
  138: 244,
  139: 241,
  140: 153,
};
/** "Reformado": no es categoria en Fincaraiz, es `condition: 4`. */
const FEATURE_REFORMADO = 97;

/** Estado del aviso en Fincaraiz → el nuestro. */
const LISTING_STATUS: Record<
  number,
  { state: PublicationState; note?: string }
> = {
  0: {
    state: PublicationState.PENDING,
    note: 'Pendiente de activar en Fincaraiz',
  },
  1: {
    state: PublicationState.PAUSED,
    note: 'Desactivado desde la Oficina Virtual de Fincaraiz',
  },
  2: {
    state: PublicationState.REJECTED,
    note: 'Sin cupo en Fincaraiz (NO_QUOTA)',
  },
  4: { state: PublicationState.PUBLISHED },
  5: {
    state: PublicationState.PAUSED,
    note: 'Caducado: vencio el cupo en Fincaraiz',
  },
  7: { state: PublicationState.REMOVED, note: 'Eliminado en Fincaraiz' },
  9: {
    state: PublicationState.REJECTED,
    note: 'Error interno de publicacion en Fincaraiz',
  },
  10: {
    state: PublicationState.PENDING,
    note: 'En proceso de publicacion en Fincaraiz',
  },
  11: {
    state: PublicationState.REJECTED,
    note: 'Moderado y rechazado por Fincaraiz',
  },
};

interface Task {
  id: string;
  status: 'READY' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'FORWARDED';
  content?: {
    status: string;
    listing_id?: string;
    fr_property_id?: number | string;
    external_code?: string;
  }[];
  messages?: {
    listings?: {
      listing_id?: string;
      external_code?: string;
      error?: {
        message?: string;
        tracking_id?: string;
        field?: { description?: string };
      };
    }[];
    images?: { url?: string; error?: { field?: { description?: string } } }[];
  };
}

@Injectable()
export class FincaraizConnector implements PortalConnector {
  readonly key = ConnectorKey.FINCARAIZ;
  readonly mode = 'push' as const;
  readonly instructions =
    'Pide a Fincaraiz el alta de Serrano como integrador con software propio: te dan la API key, el ID de cliente y, para el webhook, su id y el HUB.ID.';
  readonly credentialFields: ConnectorField[] = [
    {
      key: 'apiKey',
      label: 'API key de integrador',
      secret: true,
      required: true,
    },
    {
      key: 'hubId',
      label: 'HUB.ID del webhook',
      secret: true,
      required: false,
      help: 'Lo da Fincaraiz. Sin el, el webhook no se verifica y el estado se consulta cada minuto.',
    },
  ];
  readonly settingFields: ConnectorField[] = [
    {
      key: 'clientId',
      label: 'ID de cliente (client_id)',
      secret: false,
      required: true,
    },
    {
      key: 'agentId',
      label: 'ID de agente / sucursal (client_agent)',
      secret: false,
      required: false,
      help: 'Si se deja vacio, Fincaraiz usa el agente por defecto de la cuenta.',
    },
    {
      key: 'webhookId',
      label: 'ID del webhook',
      secret: false,
      required: false,
    },
    {
      key: 'verifyToken',
      label: 'VERIFY-TOKEN del webhook',
      secret: false,
      required: false,
      help: 'Lo inventamos nosotros y se lo comunicamos a Fincaraiz.',
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
    {
      key: 'featured',
      label: 'Destacado para inmuebles destacados',
      secret: false,
      required: false,
      help: '_DESTACADO_SILVER_, _DESTACADO_GOLD_ o _DESTACADO_BLACK_. Vacio: no se destaca.',
    },
  ];

  // --- conexion -------------------------------------------------------------

  async test(ctx: ConnectorContext): Promise<string> {
    const clients = await this.get<
      {
        id: string;
        name: string;
        remained_quota?: number;
        initial_quota?: number;
      }[]
    >(ctx, '/client');
    const list = Array.isArray(clients) ? clients : [clients];
    const client = list.find((c) => c.id === ctx.settings.clientId);
    if (!client) {
      throw new PortalConfigError(
        `La API key funciona, pero el cliente ${ctx.settings.clientId} no esta asociado a ella. Clientes visibles: ${list.map((c) => `${c.name} (${c.id})`).join(', ') || 'ninguno'}.`,
      );
    }
    let webhook = '';
    if (
      ctx.settings.webhookId &&
      ctx.settings.webhookTarget !== ctx.callbackUrl
    ) {
      await portalFetch(
        NAME,
        `${this.base(ctx)}/webhook/${ctx.settings.webhookId}/subscribe`,
        {
          method: 'POST',
          headers: this.headers(ctx),
          body: { target: ctx.callbackUrl, client_id: ctx.settings.clientId },
        },
      );
      await ctx.saveSetting('webhookTarget', ctx.callbackUrl);
      webhook = ' Webhook suscrito.';
    }
    return `Conectado como ${client.name}. Cupo: ${client.remained_quota ?? '?'} de ${client.initial_quota ?? '?'} avisos.${webhook}`;
  }

  async searchLocations(
    ctx: ConnectorContext,
    query: string,
    within?: { cityName: string },
  ): Promise<RemoteLocation[]> {
    // El autocompletado devuelve solo 5: con la ciudad detras, el barrio
    // correcto sale entre ellos aunque haya homonimos en otras ciudades.
    const q =
      within?.cityName &&
      !query.toLowerCase().includes(within.cityName.toLowerCase())
        ? `${query} ${within.cityName}`
        : query;
    const rows = await this.get<
      {
        id: string;
        name: string;
        location_type: string;
        city: string | null;
        state: string | null;
      }[]
    >(ctx, `/location/${encodeURIComponent(q)}`);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.location_type,
      city: r.city,
      state: r.state,
    }));
  }

  // --- validar y traducir ---------------------------------------------------

  validate(listing: PortalListing, ctx: ConnectorContext): string[] {
    const faltas: string[] = [];
    if (!PROPERTY_TYPE[listing.propertyTypeId]) {
      faltas.push(
        `Fincaraiz no tiene equivalente para el tipo "${listing.propertyTypeName}"`,
      );
    }
    if (listing.currency !== 'COP')
      faltas.push('Fincaraiz solo acepta precios en pesos (COP)');
    if (!this.offer(listing))
      faltas.push('Falta el precio de venta o de arriendo');
    if (!listing.description) faltas.push('Falta la descripcion');
    if (!listing.address) faltas.push('Falta la direccion');
    if (listing.latitude == null || listing.longitude == null)
      faltas.push('Faltan las coordenadas del mapa');
    if (!(listing.builtArea ?? listing.area ?? listing.privateArea))
      faltas.push('Falta el area');
    if (!ctx.location(listing)) {
      faltas.push(
        `La zona "${listing.zoneName ?? 'sin zona'}" (${listing.cityName}) no esta emparejada con un barrio de Fincaraiz`,
      );
    }
    if (!this.email(listing, ctx))
      faltas.push('No hay correo de contacto (ni del asesor ni de la cuenta)');
    if (!this.phone(listing, ctx))
      faltas.push(
        'No hay telefono de contacto (ni del asesor ni de la cuenta)',
      );
    return faltas;
  }

  private offer(
    listing: PortalListing,
  ): { offer: 'sell' | 'rent'; price: number } | null {
    // Una oferta por aviso y no se puede cambiar: se publica la venta si la
    // hay; el arriendo, solo si es lo unico.
    if (listing.forSale && listing.salePrice)
      return { offer: 'sell', price: listing.salePrice };
    if (listing.forRent && listing.rentPrice)
      return { offer: 'rent', price: listing.rentPrice };
    return null;
  }

  private email(listing: PortalListing, ctx: ConnectorContext): string | null {
    return ctx.settings.contactEmail || listing.agent?.email || null;
  }

  private phone(listing: PortalListing, ctx: ConnectorContext): string | null {
    const raw = (
      ctx.settings.contactPhone ||
      listing.agent?.phone ||
      ''
    ).replace(/\D/g, '');
    if (!raw) return null;
    return raw.length === 10 ? `+57${raw}` : `+${raw}`;
  }

  private payload(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): Record<string, unknown> {
    const type = PROPERTY_TYPE[listing.propertyTypeId];
    const offer = this.offer(listing)!;
    const location = ctx.location(listing)!;
    const features = listing.features.map((f) => f.id);
    const categories = [
      ...new Set(
        [
          ...features.map((id) => CATEGORY_BY_FEATURE[id]),
          type.category,
        ].filter((c): c is number => typeof c === 'number'),
      ),
    ];
    const phone = this.phone(listing, ctx)!;
    const whatsapp =
      !ctx.settings.contactPhone && Boolean(listing.agent?.whatsapp);

    return {
      external_code: listing.code,
      client_id: ctx.settings.clientId,
      ...(ctx.settings.agentId
        ? { client_agent: Number(ctx.settings.agentId) }
        : {}),
      offer: offer.offer,
      property_type: type.type,
      // Fincaraiz no tiene titulo: lo compone el. El nuestro abre la descripcion.
      description: `${listing.title}\n\n${listing.description}`.slice(0, 5000),
      price: Math.round(offer.price),
      ...(listing.maintenanceFee
        ? {
            administration: {
              is_included: false,
              price: Math.round(listing.maintenanceFee),
            },
          }
        : offer.offer === 'rent'
          ? { administration: { is_included: true } }
          : {}),
      negotiable: false,
      condition: this.condition(listing, features),
      stratum:
        listing.stratum && listing.stratum >= 1 && listing.stratum <= 6
          ? listing.stratum
          : 110,
      area: listing.builtArea ?? listing.area ?? listing.privateArea,
      ...(listing.privateArea ? { living_area: listing.privateArea } : {}),
      age: this.age(listing.buildingYear),
      address: { address: (listing.address ?? '').trim().slice(0, 120) },
      locations: {
        location_point: {
          latitude: listing.latitude,
          longitude: listing.longitude,
        },
        view_map: listing.showExactLocation ? 0 : 2,
        location_main_id: location.externalId,
      },
      categories,
      rooms: cap(listing.bedrooms, 19, 20),
      baths: cap(listing.bathrooms, 9, 10),
      garages: cap(listing.garages, 10, 11),
      floor: cap(listing.floor, 16, 18),
      interior_floors: type.interiorFloors ?? 0,
      listing_contact: {
        emails: [
          { email: this.email(listing, ctx), is_main: true, sort_order: 0 },
        ],
        phones: [
          {
            phone,
            is_whatsapp_number: whatsapp,
            is_click_to_call: true,
            sort_order: 0,
          },
        ],
      },
      photos: listing.images.slice(0, 30).map((image, i) => ({
        image,
        is_main: i === 0,
        sort_order: i + 1,
      })),
      ...(listing.outstanding && ctx.settings.featured
        ? {
            assignable_products: [
              { type: 'FEATURED', identifier: ctx.settings.featured },
            ],
          }
        : {}),
    };
  }

  private condition(listing: PortalListing, features: number[]): number {
    switch (listing.condition) {
      case 'NEW':
        return 1;
      case 'UNDER_CONSTRUCTION':
        return 6;
      case 'PROJECT':
        return 7;
      default:
        return features.includes(FEATURE_REFORMADO) ? 4 : 0;
    }
  }

  private age(year: number | null): number {
    if (!year) return 0;
    const years = new Date().getFullYear() - year;
    if (years < 1) return 1;
    if (years <= 8) return 2;
    if (years <= 15) return 3;
    if (years <= 30) return 4;
    return 5;
  }

  // --- operaciones -------------------------------------------------------------

  async upsert(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome> {
    const body = this.payload(listing, ctx);
    const listingId =
      ref.externalId ?? (await this.findByCode(ctx, listing.code));

    if (listingId) {
      const { task } = await this.send<{ task: Task }>(
        ctx,
        'PATCH',
        '/listing',
        [{ listing_id: listingId, ...body }],
      );
      return {
        state: PublicationState.PENDING,
        externalId: listingId,
        transactionId: `update:${task.id}`,
        note: 'Actualizacion enviada; Fincaraiz la esta procesando',
      };
    }

    const { task } = await this.send<{ task: Task }>(ctx, 'POST', '/listing', [
      body,
    ]);
    return {
      state: PublicationState.PENDING,
      transactionId: `create:${task.id}`,
      note: 'Enviado; Fincaraiz lo esta procesando',
    };
  }

  async remove(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome> {
    const listingId =
      ref.externalId ?? (await this.findByCode(ctx, listing.code));
    if (!listingId) {
      return {
        state: PublicationState.REMOVED,
        note: 'No habia aviso nuestro en Fincaraiz',
      };
    }
    await this.send(ctx, 'PATCH', '/listing/status', [
      {
        listing_id: listingId,
        client_id: ctx.settings.clientId,
        status: 'DELETED',
      },
    ]);
    return {
      state: PublicationState.REMOVED,
      externalId: listingId,
      note: 'Eliminado en Fincaraiz',
    };
  }

  async poll(
    ctx: ConnectorContext,
    ref: RemoteRef,
    listing: PortalListing | null,
  ): Promise<SyncOutcome | null> {
    const [stage, id] = (ref.transactionId ?? '').split(':');
    if (!stage || !id) return null;

    if (stage === 'confirm') return this.confirm(ctx, id);

    const task = await this.task(ctx, id);
    if (task.status === 'READY' || task.status === 'RUNNING') return null;

    if (stage === 'activate') {
      return {
        state: PublicationState.PENDING,
        transactionId: `confirm:${ref.externalId}`,
        externalId: ref.externalId,
      };
    }

    // create / update: buscar nuestro aviso en el resultado de la tarea.
    const code = listing?.code;
    const failed = task.messages?.listings?.find(
      (m) => !code || m.external_code === code,
    );
    const item = task.content?.find((c) => !code || c.external_code === code);
    if (!item || item.status === 'ERROR') {
      const why =
        failed?.error?.field?.description ??
        failed?.error?.message ??
        'Fincaraiz rechazo el aviso sin dar motivo';
      const tracking = failed?.error?.tracking_id
        ? ` (tracking ${failed.error.tracking_id})`
        : '';
      return { state: PublicationState.REJECTED, note: `${why}${tracking}` };
    }

    const listingId = item.listing_id ?? ref.externalId;
    if (!listingId)
      return {
        state: PublicationState.REJECTED,
        note: 'Fincaraiz no devolvio el id del aviso',
      };
    const externalUrl = item.fr_property_id
      ? this.publicUrl(listing, item.fr_property_id)
      : undefined;

    if (stage === 'create') {
      const { task: activation } = await this.send<{ task: Task }>(
        ctx,
        'PATCH',
        '/listing/status',
        [
          {
            listing_id: listingId,
            client_id: ctx.settings.clientId,
            status: 'ACTIVE',
          },
        ],
      );
      return {
        state: PublicationState.PENDING,
        externalId: listingId,
        externalUrl,
        transactionId: `activate:${activation.id}`,
        note: 'Creado en Fincaraiz; activandolo',
      };
    }
    // update: la tarea termino; queda ver como quedo el aviso.
    const confirmed = (await this.confirm(ctx, listingId)) ?? {
      state: PublicationState.PENDING,
      transactionId: `confirm:${listingId}`,
    };
    return {
      ...confirmed,
      externalId: listingId,
      ...(externalUrl ? { externalUrl } : {}),
    };
  }

  /** Estado real del aviso. `null` mientras siga procesandose. */
  private async confirm(
    ctx: ConnectorContext,
    listingId: string,
  ): Promise<SyncOutcome | null> {
    const raw = await this.get<unknown>(ctx, `/listing/${listingId}`, {
      Cookie: ctx.settings.clientId,
    });
    const detail = (Array.isArray(raw) ? raw[0] : raw) as
      | {
          status?: number;
          fr_property_id?: number | string;
          property_type?: string;
          offer?: string;
        }
      | undefined;
    const status = Number(detail?.status);
    const mapped = LISTING_STATUS[status];
    if (!mapped) return null;
    if (mapped.state === PublicationState.PENDING) {
      return {
        state: PublicationState.PENDING,
        transactionId: `confirm:${listingId}`,
        note: mapped.note,
      };
    }
    return {
      state: mapped.state,
      externalId: listingId,
      note: mapped.note ?? null,
      ...(detail?.fr_property_id
        ? {
            externalUrl: `https://www.fincaraiz.com.co/${TYPE_SLUG[detail.property_type ?? ''] ?? 'inmueble'}-en-${detail.offer === 'rent' ? 'arriendo' : 'venta'}/${detail.fr_property_id}`,
          }
        : {}),
    };
  }

  handleCallback(
    ctx: ConnectorContext,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ transactionId?: string }[]> {
    // Si hay HUB.ID y VERIFY-TOKEN configurados, se exigen; la URL ya lleva
    // nuestro token, esto es la verificacion que ademas pide Fincaraiz.
    const hub = header(headers, 'hub.id');
    const verify = header(headers, 'verify-token');
    if (ctx.credentials.hubId && !same(ctx.credentials.hubId, hub))
      return Promise.resolve([]);
    if (ctx.settings.verifyToken && !same(ctx.settings.verifyToken, verify))
      return Promise.resolve([]);

    const task = (body as { task?: Task } | null)?.task;
    return Promise.resolve(task?.id ? [{ transactionId: task.id }] : []);
  }

  // --- HTTP --------------------------------------------------------------------

  private base(ctx: ConnectorContext): string {
    return ctx.sandbox ? BASE.qa : BASE.production;
  }

  private headers(
    ctx: ConnectorContext,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const key = ctx.credentials.apiKey;
    if (!key) throw new PortalConfigError('Falta la API key de Fincaraiz');
    // El spec actual dice `apikey`; la revision anterior, `X-API-KEY`. Van las dos.
    return { apikey: key, 'X-API-KEY': key, ...extra };
  }

  /** GET con el parametro anti-cache que Fincaraiz exige: su gateway cachea 5 min. */
  private get<T>(
    ctx: ConnectorContext,
    path: string,
    extra: Record<string, string> = {},
  ): Promise<T> {
    const bust = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const sep = path.includes('?') ? '&' : '?';
    return portalFetch<T>(
      NAME,
      `${this.base(ctx)}${path}${sep}integrator-param=${bust}`,
      {
        headers: this.headers(ctx, extra),
      },
    );
  }

  private send<T>(
    ctx: ConnectorContext,
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
  ): Promise<T> {
    return portalFetch<T>(NAME, `${this.base(ctx)}${path}`, {
      method,
      headers: this.headers(ctx),
      body,
      timeoutMs: 60_000,
    });
  }

  private async task(ctx: ConnectorContext, id: string): Promise<Task> {
    const res = await this.get<{ task?: Task }>(ctx, `/task/${id}`);
    if (!res?.task)
      throw new PortalTransientError(
        'Fincaraiz no devolvio el estado de la tarea',
      );
    return res.task;
  }

  /**
   * El aviso que ya existe con nuestro codigo. Evita duplicar cuando un envio
   * anterior se corto antes de guardar el id, o cuando el aviso lo creo otro
   * integrador con el mismo codigo.
   */
  private async findByCode(
    ctx: ConnectorContext,
    code: string,
  ): Promise<string | null> {
    try {
      const res = await this.get<{ results?: { id: string }[] }>(
        ctx,
        `/listing?search=${encodeURIComponent(code)}&page_size=5`,
        { Cookie: ctx.settings.clientId },
      );
      return res?.results?.[0]?.id ?? null;
    } catch (err) {
      if (err instanceof PortalRejection) return null;
      throw err;
    }
  }

  private publicUrl(
    listing: PortalListing | null,
    frId: number | string,
  ): string {
    const type = listing
      ? PROPERTY_TYPE[listing.propertyTypeId]?.type
      : undefined;
    const offer =
      listing && !listing.forSale && listing.forRent ? 'arriendo' : 'venta';
    return `https://www.fincaraiz.com.co/${TYPE_SLUG[type ?? ''] ?? 'inmueble'}-en-${offer}/${frId}`;
  }
}

/** Fincaraiz codifica los conteos: por encima del tope va un codigo de "mas de". */
function cap(value: number | null, max: number, over: number): number {
  if (!value || value < 0) return 0;
  return value > max ? over : value;
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const v = headers[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
