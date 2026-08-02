import type { AuthenticatedClient } from './client-jwt.strategy';

/**
 * El cliente del portal viaja en su propia propiedad de la peticion.
 *
 * Deliberadamente NO en `req.user`: ahi vive el asesor, con su rol, y es de
 * donde leen `RolesGuard` y el scoping de cartera. Dos sujetos distintos en la
 * misma ranura es como se cuelan las escaladas de privilegio.
 */
declare global {
  namespace Express {
    interface Request {
      portalClient?: AuthenticatedClient;
    }
  }
}

export {};
