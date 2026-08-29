import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_ROLES } from '../decorators';
import { Role } from '../domain/role.enum';

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

    const role = actor.role as Role;

    /*
     * COORDINATOR y MANAGER son el mismo rol con dos nombres: el segundo es el
     * viejo, que sobrevive en los tokens ya emitidos y en las decenas de
     * `@Roles(Role.ADMIN, Role.MANAGER)` repartidas por los controladores.
     * Resolver el alias aqui —y no reescribiendo esas listas— evita que un
     * coordinador nuevo se quede fuera de media aplicacion por el nombre.
     */
    const alias =
      (role === Role.COORDINATOR && required.includes(Role.MANAGER)) ||
      (role === Role.MANAGER && required.includes(Role.COORDINATOR));

    /*
     * La direccion entra donde entra un coordinador. Manda por encima de el y
     * ve las cuatro sedes: dejarla fuera de las rutas escritas con MANAGER la
     * dejaria sin panel que mirar. Lo unico que no puede hacer —repartir
     * cuentas— se frena en el servicio de usuarios, no aqui, porque es una
     * excepcion de negocio y no de ruta.
     */
    const direccion =
      role === Role.DIRECTOR &&
      (required.includes(Role.MANAGER) || required.includes(Role.COORDINATOR));

    if (!required.includes(role) && !alias && !direccion) {
      throw new ForbiddenException(
        `Se requiere uno de estos roles: ${required.join(', ')}. El tuyo es ${actor.role}.`,
      );
    }
    return true;
  }
}
