import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role, seesAllBranches } from './domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';

/** La cabecera que manda el panel con la sede que tiene puesta el selector. */
export const CABECERA_SEDE = 'x-branch';

/**
 * Decide sobre que sede trabaja cada peticion, una vez y en un solo sitio.
 *
 * La alternativa —que cada consulta mire el rol y decida— es como se acaban
 * filtrando datos entre oficinas: basta que una de las cuarenta consultas del
 * sistema se olvide. Aqui se resuelve al entrar y las consultas solo preguntan
 * "¿que sede?" sin poder equivocarse.
 *
 * Las reglas son dos:
 *  - Quien pertenece a una sede trabaja SIEMPRE sobre la suya. La cabecera se
 *    ignora: no es una preferencia, es su alcance.
 *  - Quien las ve todas puede elegir una con la cabecera, o no mandar ninguna
 *    y verlas todas.
 */
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.user;

    if (actor) {
      const rol = actor.role as Role;
      const pedida = request.headers[CABECERA_SEDE];
      const elegida = typeof pedida === 'string' ? pedida.trim() : '';

      if (seesAllBranches(rol)) {
        RequestContext.setBranchId(elegida || null);
      } else {
        if (!actor.branchId) {
          throw new ForbiddenException(
            'Tu usuario no tiene sede asignada. Pídele a un administrador que te asigne una.',
          );
        }
        RequestContext.setBranchId(actor.branchId);
      }
    }

    return next.handle();
  }
}
