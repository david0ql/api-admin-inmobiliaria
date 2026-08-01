import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from './domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

export const IS_PUBLIC = 'iam:public';
export const REQUIRED_ROLES = 'iam:roles';

/** Marca una ruta como accesible sin token (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restringe una ruta a los roles indicados. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Inyecta el asesor autenticado en el handler. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedActor | undefined, ctx: ExecutionContext) => {
    const actor = ctx.switchToHttp().getRequest<Request>().user;
    return field && actor ? actor[field] : actor;
  },
);
