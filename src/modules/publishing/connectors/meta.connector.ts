import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
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
import { portalFetch, PortalTransientError } from '../sync/http';
import type { PortalListing } from '../sync/listing';

/**
 * Catalogo de Meta (Facebook / Instagram), vertical `home_listings`, por la
 * Catalog Batch API.
 *
 * El catalogo alimenta los anuncios dinamicos de inmuebles (Advantage+). No
 * publica en Marketplace: Meta dejo de aceptar inmuebles de catalogos en 2021.
 *
 * Cada envio es un UPDATE con `allow_upsert` —crea si no existe— y devuelve un
 * `handle`; el resultado se consulta con `check_batch_request_status`. El id
 * del item es nuestro `code`, el mismo que usaba el feed de WASI, para que el
 * catalogo conserve la identidad (y el historial) de cada inmueble.
 */
const GRAPH = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v26.0';
const NAME = 'Meta';

/** Nuestro tipo (ids de WASI) → `property_type` de Advantage+. */
const TYPE: Record<number, string> = {
  2: 'apartment',
  21: 'apartment',
  20: 'apartment',
  25: 'apartment',
  14: 'apartment',
  19: 'condo',
  1: 'house',
  11: 'house',
  28: 'house',
  10: 'house',
  22: 'house',
  24: 'house',
  7: 'house',
  5: 'land',
  6: 'land',
  17: 'land',
  32: 'land',
  29: 'land',
  31: 'land',
};

@Injectable()
export class MetaConnector implements PortalConnector {
  readonly key = ConnectorKey.META;
  readonly mode = 'push' as const;
  readonly instructions =
    'En el Business Manager: crea un usuario del sistema con el catalogo de Bienes raices asignado y genera un token que no caduque (catalog_management y business_management).';
  readonly credentialFields: ConnectorField[] = [
    {
      key: 'accessToken',
      label: 'Token del usuario del sistema',
      secret: true,
      required: true,
    },
    {
      key: 'appSecret',
      label: 'Clave secreta de la app',
      secret: true,
      required: false,
      help: 'Para firmar las llamadas (appsecret_proof). Obligatoria si la app lo exige.',
    },
  ];
  readonly settingFields: ConnectorField[] = [
    {
      key: 'catalogId',
      label: 'ID del catalogo (Bienes raices)',
      secret: false,
      required: true,
    },
    {
      key: 'businessId',
      label: 'ID del portafolio comercial',
      secret: false,
      required: false,
    },
    {
      key: 'graphVersion',
      label: 'Version de Graph API',
      secret: false,
      required: false,
      help: `Por defecto ${DEFAULT_VERSION}.`,
    },
  ];

  async test(ctx: ConnectorContext): Promise<string> {
    const catalog = await this.graph<{
      name?: string;
      vertical?: string;
      product_count?: number;
    }>(ctx, 'GET', `/${this.catalogId(ctx)}`, {
      fields: 'id,name,vertical,product_count',
    });
    if (catalog.vertical && catalog.vertical !== 'home_listings') {
      throw new PortalConfigError(
        `El catalogo "${catalog.name}" es de tipo ${catalog.vertical}; hace falta uno de Bienes raices (home_listings).`,
      );
    }
    return `Conectado al catalogo "${catalog.name}" con ${catalog.product_count ?? 0} inmuebles.`;
  }

  validate(listing: PortalListing): string[] {
    const faltas: string[] = [];
    if (!this.price(listing))
      faltas.push('Falta el precio de venta o de arriendo');
    if (!listing.regionName) faltas.push('Falta el departamento de la ciudad');
    return faltas;
  }

  private price(
    listing: PortalListing,
  ): { value: number; rent: boolean } | null {
    if (listing.forSale && listing.salePrice)
      return { value: listing.salePrice, rent: false };
    if (listing.forRent && listing.rentPrice)
      return { value: listing.rentPrice, rent: true };
    return null;
  }

  private item(listing: PortalListing): Record<string, unknown> {
    const price = this.price(listing)!;
    const isNew = listing.condition && listing.condition !== 'USED';
    const coords =
      listing.latitude != null && listing.longitude != null
        ? listing.showExactLocation
          ? {
              latitude: String(listing.latitude),
              longitude: String(listing.longitude),
            }
          : // Meta no tiene "ubicacion aproximada": se redondea a ~100 m.
            {
              latitude: listing.latitude.toFixed(3),
              longitude: listing.longitude.toFixed(3),
            }
        : {};
    const area = listing.privateArea ?? listing.builtArea ?? listing.area;
    return {
      home_listing_id: listing.code,
      name: listing.title.slice(0, 150),
      description: listing.description.replace(/<[^>]+>/g, ' ').slice(0, 5000),
      availability: price.rent ? 'for_rent' : 'for_sale',
      listing_type: isNew
        ? 'new_construction'
        : price.rent
          ? 'for_rent_by_agent'
          : 'for_sale_by_agent',
      property_type: TYPE[listing.propertyTypeId] ?? 'other',
      price: `${Math.round(price.value)} ${listing.currency}`,
      address: {
        ...(listing.showExactLocation && listing.address
          ? { addr1: listing.address }
          : {}),
        city: listing.cityName,
        region: listing.regionName,
        country: 'CO',
      },
      ...coords,
      neighborhood: [listing.zoneName ?? listing.cityName],
      ...(listing.bedrooms != null
        ? { num_beds: listing.bedrooms }
        : listing.propertyTypeId === 14
          ? { num_beds: 0 }
          : {}),
      ...(listing.bathrooms != null ? { num_baths: listing.bathrooms } : {}),
      ...(listing.buildingYear && listing.buildingYear >= 1000
        ? { year_built: String(listing.buildingYear) }
        : {}),
      ...(area ? { area_size: Math.round(area), area_unit: 'sq_m' } : {}),
      url: listing.publicUrl,
      image: listing.images.slice(0, 20).map((url) => ({ url })),
      ...(listing.videoUrl && /\.mp4(\?|$)/i.test(listing.videoUrl)
        ? { video: [{ url: listing.videoUrl }] }
        : {}),
      ...(listing.stratum ? { custom_number_0: listing.stratum } : {}),
      ...(listing.outstanding ? { custom_label_1: 'destacado' } : {}),
      status: 'active',
    };
  }

  async upsert(
    ctx: ConnectorContext,
    listing: PortalListing,
  ): Promise<SyncOutcome> {
    const handle = await this.batch(ctx, [
      { method: 'UPDATE', data: this.item(listing) },
    ]);
    return {
      state: PublicationState.PENDING,
      externalId: listing.code,
      externalUrl: listing.publicUrl,
      transactionId: `batch:${handle}`,
      note: 'Enviado al catalogo; Meta lo esta procesando',
    };
  }

  async remove(
    ctx: ConnectorContext,
    listing: PortalListing,
  ): Promise<SyncOutcome> {
    await this.batch(ctx, [
      { method: 'DELETE', data: { home_listing_id: listing.code } },
    ]);
    return {
      state: PublicationState.REMOVED,
      note: 'Quitado del catalogo de Meta',
    };
  }

  async poll(
    ctx: ConnectorContext,
    ref: RemoteRef,
    listing: PortalListing | null,
  ): Promise<SyncOutcome | null> {
    const handle = ref.transactionId?.replace(/^batch:/, '');
    if (!handle) return null;
    const res = await this.graph<{
      data?: {
        status?: string;
        errors?: { id?: string; message?: string }[];
        ids_of_invalid_requests?: string[];
      }[];
    }>(ctx, 'GET', `/${this.catalogId(ctx)}/check_batch_request_status`, {
      handle,
      load_ids_of_invalid_requests: 'true',
    });
    const batch = res.data?.[0];
    if (!batch || batch.status !== 'finished') return null;
    const code = listing?.code ?? ref.externalId;
    const error = batch.errors?.find((e) => !e.id || e.id === code);
    if (error || (code && batch.ids_of_invalid_requests?.includes(code))) {
      return {
        state: PublicationState.REJECTED,
        note: error?.message ?? 'Meta rechazo el inmueble',
      };
    }
    return { state: PublicationState.PUBLISHED, note: null };
  }

  // --- HTTP --------------------------------------------------------------------

  private catalogId(ctx: ConnectorContext): string {
    const id = ctx.settings.catalogId?.trim();
    if (!id) throw new PortalConfigError('Falta el ID del catalogo de Meta');
    return id;
  }

  private async batch(
    ctx: ConnectorContext,
    requests: unknown[],
  ): Promise<string> {
    const res = await this.graph<{
      handles?: string[];
      validation_status?: {
        retailer_id?: string;
        errors?: { message?: string }[];
      }[];
    }>(ctx, 'POST', `/${this.catalogId(ctx)}/items_batch`, {
      item_type: 'HOME_LISTING',
      allow_upsert: 'true',
      requests: JSON.stringify(requests),
    });
    const invalid = res.validation_status?.find((v) => v.errors?.length);
    if (invalid) {
      throw new PortalRejection(
        invalid.errors!.map((e) => e.message).join('; ') ||
          'Meta rechazo el inmueble',
      );
    }
    const handle = res.handles?.[0];
    if (!handle)
      throw new PortalTransientError('Meta no devolvio el handle del lote');
    return handle;
  }

  private async graph<T>(
    ctx: ConnectorContext,
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const token = ctx.credentials.accessToken;
    if (!token) throw new PortalConfigError('Falta el token de Meta');
    const auth: Record<string, string> = { access_token: token };
    if (ctx.credentials.appSecret) {
      auth.appsecret_proof = createHmac('sha256', ctx.credentials.appSecret)
        .update(token)
        .digest('hex');
    }
    const version = ctx.settings.graphVersion || DEFAULT_VERSION;
    const query = new URLSearchParams({ ...params, ...auth }).toString();
    try {
      return method === 'GET'
        ? await portalFetch<T>(NAME, `${GRAPH}/${version}${path}?${query}`)
        : await portalFetch<T>(NAME, `${GRAPH}/${version}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: query,
          });
    } catch (err) {
      if (err instanceof PortalRejection) {
        // Graph mete el codigo en el texto: (#80014) limite de lotes, (#190)
        // token invalido, (#200) sin permiso sobre el catalogo.
        if (/#80014|#4\b|#17\b|#32\b|too many calls/i.test(err.message)) {
          throw new PortalTransientError(err.message, 60_000);
        }
        if (/#190|#200|access token|permission/i.test(err.message)) {
          throw new PortalConfigError(err.message);
        }
      }
      throw err;
    }
  }
}
