import type { ConnectorKey } from '../domain/portal-connection.entity';
import type { PublicationState } from '../domain/property-publication.entity';
import type { PortalListing } from './listing';

/** Un campo que hay que rellenar en el panel para conectar el portal. */
export interface ConnectorField {
  key: string;
  label: string;
  /** Secreto: va cifrado y el panel nunca lo vuelve a ver. */
  secret: boolean;
  required: boolean;
  help?: string;
}

/** Todo lo que un conector necesita saber de la cuenta para hablar con el portal. */
export interface ConnectorContext {
  portalId: number;
  portalName: string;
  credentials: Record<string, string>;
  settings: Record<string, string>;
  sandbox: boolean;
  /** URL publica a la que el portal puede llamar de vuelta con resultados. */
  callbackUrl: string;
  /** Guarda un ajuste que el conector descubre (un id de publisher, un token cacheado). */
  saveSetting(key: string, value: string): Promise<void>;
  /**
   * Equivalencia de la ubicacion del inmueble en este portal: la de su zona
   * si esta emparejada, si no la de su ciudad, si no nada.
   */
  location(listing: PortalListing): MappedLocation | null;
}

export interface MappedLocation {
  externalId: string;
  externalName: string;
  extra: Record<string, string>;
  /** De la zona (barrio) o solo de la ciudad. */
  level: 'zone' | 'city';
  verified: boolean;
}

/** Un lugar del arbol geografico del portal, para emparejar con los nuestros. */
export interface RemoteLocation {
  id: string;
  name: string;
  /** CITY, NEIGHBOURHOOD, ZONE… en el vocabulario del portal. */
  type: string;
  city: string | null;
  state: string | null;
  extra?: Record<string, string>;
}

/** Lo que ya sabemos del anuncio en el portal. */
export interface RemoteRef {
  externalId: string | null;
  transactionId: string | null;
}

/** El resultado de hablar con el portal. */
export interface SyncOutcome {
  /**
   * PUBLISHED: arriba. PENDING: aceptado, el resultado llega despues
   * (`transactionId`). REJECTED: el portal dijo que no, y reintentar sin
   * cambiar la ficha dara lo mismo. REMOVED: retirado.
   */
  state: PublicationState;
  externalId?: string | null;
  externalUrl?: string | null;
  transactionId?: string | null;
  /** Explicacion legible: el motivo del rechazo, lo que falta en la ficha. */
  note?: string | null;
}

/**
 * Error que NO se arregla reintentando: falta un dato en la ficha, el portal
 * no conoce ese barrio, no hay cupo. Corta los reintentos y se muestra tal
 * cual en la ficha. Cualquier otro error se trata como transitorio.
 */
export class PortalRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalRejection';
  }
}

/** Error de configuracion: credenciales malas o incompletas. Tampoco se reintenta. */
export class PortalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalConfigError';
  }
}

/**
 * El contrato de cada integracion.
 *
 * `push`: el conector llama al portal (API). `feed`: el portal descarga un XML
 * nuestro; enviar un inmueble es incluirlo en ese XML y el portal lo recoge en
 * su proxima lectura.
 */
export interface PortalConnector {
  readonly key: ConnectorKey;
  readonly mode: 'push' | 'feed';
  readonly credentialFields: ConnectorField[];
  readonly settingFields: ConnectorField[];
  /** Que tiene que hacer quien configura, en una frase. */
  readonly instructions: string;

  /** Comprueba credenciales. Devuelve un mensaje para el panel o lanza. */
  test(ctx: ConnectorContext): Promise<string>;

  /**
   * Faltas de la ficha que este portal no acepta, en castellano. Se comprueba
   * antes de enviar para no gastar una llamada ni un cupo en un rechazo seguro.
   */
  validate(
    listing: PortalListing,
    ctx: ConnectorContext,
  ): string[] | Promise<string[]>;

  upsert(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome>;

  remove(
    ctx: ConnectorContext,
    listing: PortalListing,
    ref: RemoteRef,
  ): Promise<SyncOutcome>;

  /**
   * Catalogo geografico del portal, para emparejar nuestras zonas. Solo lo
   * tienen los portales que piden ids de ubicacion propios.
   */
  searchLocations?(
    ctx: ConnectorContext,
    query: string,
    /** La ciudad donde buscar: la nuestra y, si ya esta emparejada, la del portal. */
    within?: { cityName: string; cityExternalId: string | null },
  ): Promise<RemoteLocation[]>;

  /** Pregunta por una operacion asincrona. `null` = sigue en curso. */
  poll?(
    ctx: ConnectorContext,
    ref: RemoteRef,
    listing: PortalListing | null,
  ): Promise<SyncOutcome | null>;

  /**
   * Interpreta lo que el portal manda de vuelta. Devuelve a que anuncio se
   * refiere (por transaccion o por referencia nuestra) y como quedo.
   */
  handleCallback?(
    ctx: ConnectorContext,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<
    // Sin `outcome`: el aviso cambio pero hay que preguntar como quedo
    // (`poll`). Es lo normal cuando el callback solo dice "termino la tarea X".
    { transactionId?: string; reference?: string; outcome?: SyncOutcome }[]
  >;
}
