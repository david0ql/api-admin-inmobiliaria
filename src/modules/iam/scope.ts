import type { SelectQueryBuilder } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import {
  Role,
  canWriteAcrossTeam,
  seesAllBranches,
  seesEverything,
} from './domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';
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

/**
 * Visibilidad por sede.
 *
 * Se aplica igual que la de asesor —predicado en el QueryBuilder, nunca filtro
 * en memoria— para que los totales y la paginacion sigan cuadrando: un
 * coordinador con 200 inmuebles de 642 tiene que leer "200", no "642" con 200
 * filas.
 *
 * La sede la decide el interceptor al entrar la peticion, asi que aqui no hay
 * nada que interpretar: o hay una y se filtra, o no la hay y es que quien
 * pregunta las ve todas.
 */
export function applyBranchScope<T extends object>(
  qb: SelectQueryBuilder<T>,
  branchColumn: string,
): SelectQueryBuilder<T> {
  const branchId = RequestContext.branchId();
  if (!branchId) return qb;
  return qb.andWhere(`${branchColumn} = :scopedBranchId`, {
    scopedBranchId: branchId,
  });
}

/**
 * La sede que le toca a un registro nuevo.
 *
 * Quien pertenece a una sede solo puede crear en la suya, aunque mande otra en
 * el cuerpo de la peticion. Quien las ve todas tiene que decir en cual, porque
 * "en ninguna" no existe: un inmueble sin oficina que lo lleve no lo trabaja
 * nadie.
 */
export function resolveBranch(
  actor: AuthenticatedActor,
  requested?: string | null,
): string {
  const propia = actor.branchId ?? null;

  if (!seesAllBranches(actor.role as Role)) {
    if (!propia) {
      throw new ForbiddenException('Tu usuario no tiene sede asignada');
    }
    if (requested && requested !== propia) {
      throw new ForbiddenException('No puedes crear registros en otra sede');
    }
    return propia;
  }

  const elegida = requested ?? RequestContext.branchId() ?? propia;
  if (!elegida) {
    throw new ForbiddenException(
      'Elige una sede antes de crear: con "todas las sedes" puesto no hay dónde guardarlo',
    );
  }
  return elegida;
}

/** 403 si el actor no puede tocar algo que vive en otra sede. */
export function assertSameBranch(
  actor: AuthenticatedActor,
  branchId: string | null | undefined,
): void {
  if (seesAllBranches(actor.role as Role)) return;
  if (branchId && branchId !== actor.branchId) {
    throw new ForbiddenException('Ese registro pertenece a otra sede');
  }
}
