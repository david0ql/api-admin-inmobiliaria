/** Estado comercial del inmueble. WASI solo usaba Available/Sold. */
export enum Availability {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  SOLD = 'SOLD',
  RENTED = 'RENTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** Visibilidad en la web publica y en los portales. */
export enum PublicationStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  OUTSTANDING = 'OUTSTANDING',
  INACTIVE = 'INACTIVE',
}

/**
 * Que ES una fila de `property`.
 *
 * Un inmueble suelto no pertenece a ningun conjunto. Una unidad SI pertenece a
 * uno: es uno de los apartamentos de un edificio que la agencia tiene dado de
 * alta como agrupacion.
 *
 * OJO CON EL NOMBRE. `PROJECT_UNIT` dice "unidad de proyecto" y hoy eso es
 * engañoso: los 57 registros de `property_family` son `kind = COMPLEX` y
 * `status = DELIVERED` —edificios entregados, sin constructora ni año de
 * entrega— y el 79% de lo que agrupan son inmuebles de segunda mano. Esto
 * distingue "suelto" de "agrupado", y nada mas.
 *
 * En particular NO dice si es obra nueva: eso es `condition`, lo decide quien
 * da de alta el inmueble y no se deduce de con quien esta agrupado. Deducirlo
 * ya costo 170 fichas mal marcadas.
 */
export enum PropertyKind {
  USED = 'USED',
  PROJECT_UNIT = 'PROJECT_UNIT',
}

export enum PropertyCondition {
  NEW = 'NEW',
  USED = 'USED',
  PROJECT = 'PROJECT',
  UNDER_CONSTRUCTION = 'UNDER_CONSTRUCTION',
}

export enum MapPublication {
  HIDDEN = 'HIDDEN',
  APPROXIMATE = 'APPROXIMATE',
  EXACT = 'EXACT',
}

export enum RentPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

/** Equivalencias con los ids de WASI, usadas por el importador. */
export const WASI_AVAILABILITY: Record<number, Availability> = {
  1: Availability.AVAILABLE,
  2: Availability.SOLD,
  3: Availability.RENTED,
};

export const WASI_PUBLICATION_STATUS: Record<number, PublicationStatus> = {
  1: PublicationStatus.ACTIVE,
  2: PublicationStatus.INACTIVE,
  3: PublicationStatus.OUTSTANDING,
};

export const WASI_CONDITION: Record<number, PropertyCondition> = {
  1: PropertyCondition.NEW,
  2: PropertyCondition.USED,
  3: PropertyCondition.PROJECT,
  4: PropertyCondition.UNDER_CONSTRUCTION,
};

export const WASI_MAP_PUBLICATION: Record<number, MapPublication> = {
  1: MapPublication.HIDDEN,
  2: MapPublication.APPROXIMATE,
  3: MapPublication.EXACT,
};

export const WASI_RENT_PERIOD: Record<number, RentPeriod> = {
  1: RentPeriod.DAILY,
  2: RentPeriod.WEEKLY,
  3: RentPeriod.BIWEEKLY,
  4: RentPeriod.MONTHLY,
  5: RentPeriod.ANNUAL,
};
