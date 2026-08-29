import { Property } from '../properties/domain/property.entity';
import { PropertyFamily } from '../properties/domain/property-family.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { UnitType, UnitTypeKind } from '../properties/domain/unit-type.entity';

/**
 * Lo que sale a la calle.
 *
 * Las rutas públicas devolvían las entidades tal cual, y una entidad
 * serializada no es una decisión: es lo que quede. Así salían la ruta interna
 * de cada fichero (`storageKey`), la URL de WASI de donde vino (`sourceUrl`),
 * la sede que lleva el inmueble, el asesor asignado y el contador de visitas —
 * en un endpoint sin sesión. Ninguno es un dato de nadie, pero el patrón es el
 * que un día saca a la calle la columna que alguien añada sin pensar en esto.
 *
 * Por eso esto es una lista de lo que SÍ sale, no de lo que se quita: una
 * columna nueva no aparece en la web hasta que alguien la escriba aquí, que es
 * justo el momento de preguntarse si debe.
 *
 * Los campos son los que la web usa hoy, comprobados uno a uno contra
 * `web-sell/`. Lo que se queda fuera no lo lee nadie.
 */

export interface PublicUnitType {
  id: string;
  code: string;
  name: string;
  kind: UnitTypeKind;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  minArea: number | null;
  maxArea: number | null;
  builtArea: number | null;
}

export interface PublicImage {
  id: string;
  url: string;
  urlMedium: string | null;
  urlLarge: string;
  urlOriginal: string;
  description: string | null;
  isMain: boolean;
  position: number;
  width: number | null;
  height: number | null;
}

export interface PublicFamilyRef {
  id: string;
  name: string;
  slug: string;
  kind: PropertyFamily['kind'];
  status: PropertyFamily['status'];
  description: string | null;
  developer: string | null;
  address: string | null;
  cityId: number | null;
  zoneId: number | null;
  latitude: string | null;
  longitude: string | null;
  deliveryYear: number | null;
  totalUnits: number | null;
  coverUrl: string | null;
  published: boolean;
  createdAt: Date;
}

/**
 * La tipología recortada.
 *
 * Además de quitar lo interno, arregla que el mismo concepto viajara con dos
 * formas: las áreas son `numeric` y `numeric` llega como texto —`"71.00"`—, de
 * modo que quien leyera `minArea` aquí encontraba `undefined` mientras que en
 * la ficha del proyecto era un número. Se sirve con los nombres y los tipos de
 * las filas de `unitTypes`.
 *
 * Para el suelo, alcobas, baños y garajes salen en `null` y no en cero: un lote
 * no tiene cero alcobas, es que la pregunta no aplica, y un cero se pintaría
 * como "0 alcobas".
 */
export function publicUnitType(
  unitType: UnitType | null | undefined,
): PublicUnitType | null {
  if (!unitType) return null;
  const auto = unitType.kind === UnitTypeKind.AUTO;
  return {
    id: unitType.id,
    code: unitType.code,
    name: unitType.name,
    kind: unitType.kind,
    bedrooms: auto ? null : unitType.bedrooms,
    bathrooms: auto ? null : unitType.bathrooms,
    garages: auto ? null : unitType.garages,
    minArea: numero(unitType.areaMin),
    maxArea: numero(unitType.areaMax),
    builtArea: numero(unitType.builtArea),
  };
}

/**
 * La foto sin su contabilidad.
 *
 * Fuera `storageKey` —dónde vive el fichero en el servidor— y `sourceUrl` —de
 * qué cuenta de WASI se trajo—, que son las dos cosas que no le importan a
 * quien mira una casa y sí a quien mira el sistema.
 */
export function publicImage(image: PropertyImage): PublicImage {
  return {
    id: image.id,
    url: image.url,
    urlMedium: image.urlMedium,
    urlLarge: image.urlLarge,
    urlOriginal: image.urlOriginal,
    description: image.description,
    isMain: image.isMain,
    position: image.position,
    width: image.width,
    height: image.height,
  };
}

/** El proyecto como referencia dentro de un inmueble o de un listado. */
export function publicFamily(
  family: PropertyFamily | null | undefined,
): PublicFamilyRef | null {
  if (!family) return null;
  return {
    id: family.id,
    name: family.name,
    slug: family.slug,
    kind: family.kind,
    status: family.status,
    description: family.description,
    developer: family.developer,
    address: family.address,
    cityId: family.cityId,
    zoneId: family.zoneId,
    latitude: family.latitude,
    longitude: family.longitude,
    deliveryYear: family.deliveryYear,
    totalUnits: family.totalUnits,
    coverUrl: family.coverUrl,
    published: family.published,
    createdAt: family.createdAt,
  };
}

export interface PublicPropertyShape {
  id: string;
  code: string;
  title: string;
  address: string | null;
  forSale: boolean;
  forRent: boolean;
  forTransfer: boolean;
  forTemporaryRent: boolean;
  salePrice: number | null;
  rentPrice: number | null;
  maintenanceFee: number | null;
  rentPeriod: Property['rentPeriod'];
  currency: Property['currency'] | null;
  currencyId: number;
  propertyType: Property['propertyType'] | null;
  propertyTypeId: number;
  city: Property['city'] | null;
  cityId: number;
  zone: Property['zone'];
  zoneId: number | null;
  latitude: number | null;
  longitude: number | null;
  mapPublication: Property['mapPublication'];
  area: number | null;
  builtArea: number | null;
  privateArea: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  floor: number | null;
  stratum: number | null;
  condition: Property['condition'];
  buildingYear: number | null;
  observations: string | null;
  observationsEn: string | null;
  availability: Property['availability'];
  publicationStatus: Property['publicationStatus'];
  videoUrl: string | null;
  tourUrl: string | null;
  images: PublicImage[];
  features: Property['features'];
  family: PublicFamilyRef | null;
  familyId: string | null;
  unitType: PublicUnitType | null;
  unitTypeId: string | null;
  createdAt: Date;
}

/**
 * El inmueble tal y como puede verlo un visitante.
 *
 * `createdAt` se queda porque la web marca los recién publicados con él.
 * `publicationStatus` se queda porque el portal del propietario lo pinta. Lo
 * demás que falta —`branchId`, `assignedAgentId`, `visits`, `wasiId`,
 * `wasiGalleryId`, `labelId`, `publicUrl`, `updatedAt`, `deletedAt`— no lo lee
 * nadie y no tiene por qué estar.
 */
export function publicProperty(property: Property): PublicPropertyShape {
  return {
    id: property.id,
    code: property.code,
    title: property.title,
    address: property.address,
    forSale: property.forSale,
    forRent: property.forRent,
    forTransfer: property.forTransfer,
    forTemporaryRent: property.forTemporaryRent,
    salePrice: property.salePrice,
    rentPrice: property.rentPrice,
    maintenanceFee: property.maintenanceFee,
    rentPeriod: property.rentPeriod,
    currency: property.currency ?? null,
    currencyId: property.currencyId,
    propertyType: property.propertyType ?? null,
    propertyTypeId: property.propertyTypeId,
    city: property.city ?? null,
    cityId: property.cityId,
    zone: property.zone,
    zoneId: property.zoneId,
    latitude: property.latitude,
    longitude: property.longitude,
    mapPublication: property.mapPublication,
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
    observations: property.observations,
    observationsEn: property.observationsEn,
    availability: property.availability,
    publicationStatus: property.publicationStatus,
    videoUrl: property.videoUrl,
    tourUrl: property.tourUrl,
    images: (property.images ?? []).map(publicImage),
    features: property.features ?? [],
    family: publicFamily(property.family),
    familyId: property.familyId,
    unitType: publicUnitType(property.unitType),
    unitTypeId: property.unitTypeId,
    createdAt: property.createdAt,
  };
}

/** `numeric` llega como texto: la web espera un número o nada. */
function numero(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
