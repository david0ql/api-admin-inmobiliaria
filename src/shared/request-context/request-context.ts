import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthenticatedActor {
  id: string;
  email: string;
  role: string;
  fullName: string;
  /** Sigue con la clave generica: la API le queda cerrada hasta cambiarla. */
  mustSetPassword: boolean;
  /** La sede a la que pertenece. Nula en quien las ve todas. */
  branchId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedActor;
    }
  }
}

export interface RequestStore {
  actor?: AuthenticatedActor;
  requestId: string;
  /**
   * La sede sobre la que trabaja ESTA peticion.
   *
   * Para casi todo el equipo es la suya y no hay nada que elegir. Para quien
   * ve varias, es la que tenga puesta en el selector; `null` significa "todas"
   * y solo puede llegar a valer null si el rol lo permite —de eso se encarga
   * el interceptor, no cada consulta—.
   */
  branchId?: string | null;
}

const storage = new AsyncLocalStorage<RequestStore>();

/**
 * Contexto por peticion. Lo usan el scoping por asesor y la auditoria de
 * actividades para saber quien actua sin arrastrar el `user` por cada firma.
 */
export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestStore | undefined {
    return storage.getStore();
  },
  actor(): AuthenticatedActor | undefined {
    return storage.getStore()?.actor;
  },
  setActor(actor: AuthenticatedActor): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
  /** La sede de esta peticion; `null` es "todas las sedes". */
  branchId(): string | null | undefined {
    return storage.getStore()?.branchId;
  },
  setBranchId(branchId: string | null): void {
    const store = storage.getStore();
    if (store) store.branchId = branchId;
  },
};
