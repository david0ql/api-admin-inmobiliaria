import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticatedClient } from './client-jwt.strategy';

export const ALLOW_PENDING_CLIENT_PASSWORD = 'portal:allow-pending-password';

/** Ruta accesible aunque el cliente siga con la clave que le puso el asesor. */
export const AllowPendingClientPassword = () =>
  SetMetadata(ALLOW_PENDING_CLIENT_PASSWORD, true);

/**
 * Guard del portal. Se aplica de forma explicita en sus controladores: las
 * rutas van marcadas `@Public()` para que el guard global de asesores las deje
 * pasar, y es este el que decide.
 *
 * Ademas de autenticar, corta el paso mientras el cliente conserve la clave
 * inicial que le dicto un asesor — igual que `MustChangePasswordGuard` hace con
 * la plantilla, y por el mismo motivo: una contrasena dicha por telefono no es
 * un secreto.
 */
@Injectable()
export class ClientAuthGuard extends AuthGuard('jwt-client') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_CLIENT_PASSWORD,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const client = context.switchToHttp().getRequest<Request>().portalClient;

    if (client?.mustChangePassword) {
      throw new ForbiddenException(
        'Cambia la contrasena que te dio el asesor antes de continuar.',
      );
    }
    return true;
  }

  handleRequest<TUser = AuthenticatedClient>(
    err: unknown,
    user: unknown,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err instanceof Error
        ? err
        : new UnauthorizedException('Token ausente o invalido');
    }
    /*
     * En `portalClient` y no en `req.user`: `req.user` es donde el resto de la
     * aplicacion espera encontrar un asesor con su rol. Un cliente ahi haria
     * que `RolesGuard` comparase roles inexistentes y que el scoping de cartera
     * tomase un id de cliente por uno de asesor.
     */
    const request = context.switchToHttp().getRequest<Request>();
    request.portalClient = user as AuthenticatedClient;
    return user as TUser;
  }
}

/** El cliente autenticado, para los controladores del portal. */
export const CurrentClient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedClient => {
    const client = context.switchToHttp().getRequest<Request>().portalClient;
    if (!client) throw new UnauthorizedException('Sin sesion de cliente');
    return client;
  },
);
