import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_ROLES } from '../decorators';
import type { Role } from '../domain/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const actor = context.switchToHttp().getRequest<Request>().user;
    if (!actor) throw new ForbiddenException('Sin identidad en la peticion');

    if (!required.includes(actor.role as Role)) {
      throw new ForbiddenException(
        `Se requiere uno de estos roles: ${required.join(', ')}. El tuyo es ${actor.role}.`,
      );
    }
    return true;
  }
}
