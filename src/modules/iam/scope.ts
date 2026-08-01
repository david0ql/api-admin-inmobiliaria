import type { SelectQueryBuilder } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { Role, canWriteAcrossTeam, seesEverything } from './domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * Visibilidad por asesor.
 *
 * Se aplica como predicado en el QueryBuilder — nunca filtrando en memoria —
 * para que la paginacion y los conteos sigan siendo correctos: un AGENT con 850
 * clientes de 7.529 debe ver `total: 850`, no 7.529 con 850 filas.
 */
export function applyOwnershipScope<T extends object>(
  qb: SelectQueryBuilder<T>,
  actor: AuthenticatedActor,
  ownerColumn: string,
): SelectQueryBuilder<T> {
  if (seesEverything(actor.role as Role)) return qb;
  return qb.andWhere(`${ownerColumn} = :scopedAgentId`, {
    scopedAgentId: actor.id,
  });
}

/** Lanza 403 si el actor no puede escribir sobre un registro de otro asesor. */
export function assertCanMutate(
  actor: AuthenticatedActor,
  ownerAgentId: string | null | undefined,
  what = 'este registro',
): void {
  if (canWriteAcrossTeam(actor.role as Role)) return;
  if ((actor.role as Role) === Role.VIEWER) {
    throw new ForbiddenException('Tu perfil es de solo lectura');
  }
  if (ownerAgentId && ownerAgentId !== actor.id) {
    throw new ForbiddenException(
      `No puedes modificar ${what}: pertenece a otro asesor`,
    );
  }
}

/** Devuelve el asesor propietario efectivo al crear un registro. */
export function resolveOwner(
  actor: AuthenticatedActor,
  requested?: string | null,
): string {
  if (!requested) return actor.id;
  if (requested !== actor.id && !canWriteAcrossTeam(actor.role as Role)) {
    throw new ForbiddenException('No puedes asignar registros a otro asesor');
  }
  return requested;
}
