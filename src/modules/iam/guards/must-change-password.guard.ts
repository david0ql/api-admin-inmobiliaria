import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const ALLOW_PENDING_PASSWORD = 'iam:allow-pending-password';

/** Ruta accesible aunque el asesor siga con la clave generica. */
export const AllowPendingPassword = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD, true);

/**
 * Los asesores importados nacen con una clave generica compartida. Mientras no
 * la cambien, esa credencial vale para toda la plantilla — asi que la sesion
 * solo sirve para una cosa: cambiarla.
 *
 * Sin este guard, "clave generica" equivaldria a dejar la cartera de 7.529
 * clientes abierta a quien conozca una sola contrasena.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_PASSWORD,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const actor = context.switchToHttp().getRequest<Request>().user;
    if (actor?.mustSetPassword) {
      throw new ForbiddenException(
        'Debes cambiar la contrasena inicial antes de usar la aplicacion. ' +
          'Envia POST /auth/change-password con tu clave actual y la nueva.',
      );
    }
    return true;
  }
}
