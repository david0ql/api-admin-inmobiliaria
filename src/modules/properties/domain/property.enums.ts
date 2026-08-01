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
