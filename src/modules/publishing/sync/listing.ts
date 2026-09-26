import { createHash } from 'node:crypto';
import type { Property } from '../../properties/domain/property.entity';
import {
  Availability,
  MapPublication,
  PublicationStatus,
} from '../../properties/domain/property.enums';
import { slugify } from '../../properties/families.service';
import { ImageKind } from '../../media/image-asset.entity';

/**
 * El inmueble tal y como sale hacia los portales.
 *
 * Una forma neutra entre nuestra ficha y la de cada portal: cada conector la
 * traduce a su formato, pero ninguno vuelve a mirar la entidad. Asi las reglas
 * comunes —que foto va primero, que URL es la publica, a quien se contacta—
 * se deciden una vez y no ocho.
 */
export interface PortalListing {
  id: string;
  /** Nuestra referencia, la que ve el cliente y la que mandamos como id externo. */
  code: string;
  /** El id que tenia en WASI: algunos portales conocen el anuncio por el. */
  wasiId: number | null;
  title: string;
  description: string;

  forSale: boolean;
  forRent: boolean;
  salePrice: number | null;
  rentPrice: number | null;
  maintenanceFee: number | null;
  currency: string;

  propertyTypeId: number;
  propertyTypeName: string;

  countryName: string | null;
  regionId: number | null;
  regionName: string | null;
  cityId: number;
  cityName: string;
  zoneId: number | null;
  zoneName: string | null;
  address: string | null;
  /** Si se puede mostrar la direccion exacta, segun lo que eligio el asesor. */
  showExactLocation: boolean;
  latitude: number | null;
  longitude: number | null;

  area: number | null;
  builtArea: number | null;
  privateArea: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  floor: number | null;
  stratum: number | null;
  condition: string | null;
  buildingYear: number | null;

  features: { id: number; name: string }[];
  /** URLs absolutas en JPG, la portada primero. Solo fotos, sin planos. */
  images: string[];
  videoUrl: string | null;
  tourUrl: string | null;
  /** Ficha en nuestra web. */
  publicUrl: string;

  outstanding: boolean;
  /** Se puede publicar: activa, disponible, no es de muestra, no esta borrada. */
  publishable: boolean;
  /** Si no se puede publicar, por que. */
  blockers: string[];

  agent: {
    name: string;
    email: string;
    phone: string | null;
    whatsapp: string | null;
  } | null;
}

export interface ListingUrls {
  /** Dominio de la web publica, sin barra final. */
  site: string;
  /** Base de la API vista desde fuera, con prefijo: https://…/api/v1 */
  api: string;
}

/** Estados comerciales en los que el anuncio tiene sentido. */
const ON_THE_MARKET = new Set([Availability.AVAILABLE, Availability.RESERVED]);
const VISIBLE = new Set([
  PublicationStatus.ACTIVE,
  PublicationStatus.OUTSTANDING,
]);

/**
 * La URL en JPG de una foto nuestra.
 *
 * Todo el inventario esta en WebP, y varios portales —Meta el primero— solo
 * aceptan JPG o PNG. `PortalImagesController` convierte y guarda en cache.
 * La marca de version (`?r=` en nuestras URLs) pasa al nombre porque hay
 * portales que tiran la query al descargar, y entonces una foto retocada
 * seguiria viendose como la vieja.
 */
export function jpgUrl(apiBase: string, webpUrl: string): string | null {
  const [path, query] = webpUrl.split('?');
  const match =
    /^\/media\/properties\/([0-9a-f-]{36})\/([0-9a-f-]{36})-l\.webp$/.exec(
      path,
    );
  if (!match) return null;
  const version = /(?:^|&)r=([a-z0-9]+)/.exec(query ?? '')?.[1];
  const file = version ? `${match[2]}-l.${version}.jpg` : `${match[2]}-l.jpg`;
  return `${apiBase}/public/portal-images/properties/${match[1]}/${file}`;
}

export function buildListing(
  property: Property,
  urls: ListingUrls,
): PortalListing {
  const images = [...(property.images ?? [])]
    .filter((img) => img.kind === ImageKind.PHOTO)
    .sort(
      (a, b) => Number(b.isMain) - Number(a.isMain) || a.position - b.position,
    )
    .map((img) => jpgUrl(urls.api, img.urlLarge))
    .filter((url): url is string => Boolean(url));

  const blockers: string[] = [];
  if (property.isSample) blockers.push('Es una ficha de muestra');
  if (property.deletedAt) blockers.push('El inmueble esta borrado');
  if (!VISIBLE.has(property.publicationStatus)) {
    blockers.push('El inmueble no esta activo (borrador o inactivo)');
  }
  if (!ON_THE_MARKET.has(property.availability)) {
    blockers.push(
      'El inmueble ya no esta disponible (vendido, arrendado o retirado)',
    );
  }
  if (!images.length) blockers.push('No tiene fotos');

  const agent = property.assignedAgent;
  const agentPhone = agent?.cellPhone?.replace(/\D/g, '') || null;

  return {
    id: property.id,
    code: property.code,
    wasiId: property.wasiId,
    title: property.title.trim(),
    description: (property.observations ?? '').trim(),
    forSale: property.forSale,
    forRent: property.forRent || property.forTemporaryRent,
    salePrice: property.salePrice,
    rentPrice: property.rentPrice,
    maintenanceFee: property.maintenanceFee,
    currency: property.currency?.iso ?? 'COP',
    propertyTypeId: property.propertyTypeId,
    propertyTypeName: property.propertyType?.name ?? '',
    countryName: property.city?.region?.country?.name ?? null,
    regionId: property.city?.region?.id ?? null,
    regionName: property.city?.region?.name ?? null,
    cityId: property.cityId,
    cityName: property.city?.name ?? '',
    zoneId: property.zoneId,
    zoneName: property.zone?.name ?? null,
    address: property.address,
    showExactLocation: property.mapPublication === MapPublication.EXACT,
    latitude: property.latitude,
    longitude: property.longitude,
    area: property.area,
    builtArea: property.builtArea,
    privateArea: property.privateArea,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    garages: property.garages,
    floor: property.floor,
    stratum: property.stratum,
    condition: property.condition,
    buildingYear: property.buildingYear,
    features: (property.features ?? []).map((f) => ({
      id: f.id,
      name: f.name,
    })),
    images,
    videoUrl: property.videoUrl,
    tourUrl: property.tourUrl,
    publicUrl: `${urls.site}/${slugify(property.title) || 'inmueble'}/${property.code}`,
    outstanding: property.publicationStatus === PublicationStatus.OUTSTANDING,
    publishable: blockers.length === 0,
    blockers,
    agent: agent
      ? {
          name: `${agent.firstName} ${agent.lastName ?? ''}`.trim(),
          email: agent.email,
          phone: agentPhone,
          whatsapp: agent.hasWhatsapp ? agentPhone : null,
        }
      : null,
  };
}

/**
 * Huella de lo que se envia. Si cambia, el anuncio del portal esta desfasado.
 * Excluye `publishable`/`blockers`, que no son contenido del anuncio.
 */
export function listingHash(listing: PortalListing): string {
  const content: Partial<PortalListing> = { ...listing };
  delete content.publishable;
  delete content.blockers;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
