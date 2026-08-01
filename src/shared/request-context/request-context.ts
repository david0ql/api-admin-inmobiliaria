import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthenticatedActor {
  id: string;
  email: string;
  role: string;
  fullName: string;
  /** Sigue con la clave generica: la API le queda cerrada hasta cambiarla. */
  mustSetPassword: boolean;
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
};
