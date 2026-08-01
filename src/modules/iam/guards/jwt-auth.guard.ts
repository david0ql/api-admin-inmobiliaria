import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from '../decorators';
import { RequestContext } from '../../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../../shared/request-context/request-context';

/**
 * Guard global. Todo esta cerrado por defecto; abrir una ruta exige marcarla
 * con `@Public()` de forma explicita.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: unknown, user: unknown): any {
    if (err || !user) {
      throw err instanceof Error
        ? err
        : new UnauthorizedException('Token ausente o invalido');
    }
    // Publica el actor en el contexto de la peticion para el scoping y la auditoria.
    RequestContext.setActor(user as AuthenticatedActor);
    return user;
  }
}
