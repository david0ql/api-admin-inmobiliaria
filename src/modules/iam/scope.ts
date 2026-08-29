import type { SelectQueryBuilder } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import {
  Role,
  canWriteAcrossTeam,
  outranks,
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

/** Lo minimo que hay que saber de alguien para decidir si se le puede editar. */
export interface EditableAgent {
  id: string;
  role: Role;
  branchId: string | null;
}

/**
 * Quien puede editar la ficha de quien.
 *
 * Es una sola funcion y no una comprobacion repartida por cada ruta porque
 * son las mismas tres preguntas siempre —¿soy yo?, ¿mando sobre el?, ¿es de
 * mi sede?— y la primera vez que se contesten distinto en dos sitios habra
 * una puerta abierta que nadie sabra que existe.
 *
 * No filtra que CAMPOS puede tocar: eso es otra pregunta y la contesta
 * `assertCanChangeRoleOrBranch`. Aqui solo se decide si esta ficha es suya.
 */
export function assertCanEditAgent(
  actor: AuthenticatedActor,
  target: EditableAgent,
): void {
  // Cada uno es dueño de su propia ficha. Que pueda cambiar de ella es harina
  // de otro costal.
  if (actor.id === target.id) return;

  const rol = actor.role as Role;

  // El administrador edita a cualquiera, incluido otro administrador: es la
  // unica figura que no tiene a nadie por encima que le arregle un correo mal
  // escrito.
  if (rol === Role.ADMIN) return;

  if (!outranks(rol, target.role)) {
    throw new ForbiddenException(
      'Solo puedes editar a personas por debajo de tu perfil',
    );
  }

  if (seesAllBranches(rol)) return;

  /*
   * Aqui no vale `assertSameBranch`: esa deja pasar los registros sin sede,
   * que para un inmueble es un hueco sin importancia y para una persona
   * significa "administrador o direccion". Un coordinador no puede tocar a
   * quien no cuelga de ninguna oficina, asi que la sede se exige de verdad.
   */
  if (!actor.branchId || target.branchId !== actor.branchId) {
    throw new ForbiddenException('Esa persona pertenece a otra sede');
  }
}

/**
 * El rol y la sede solo los mueve el administrador, y nunca sobre si mismo.
 *
 * Se rechaza en vez de ignorarlo en silencio: un coordinador que crea haberle
 * puesto el perfil de administrador a alguien y se va tan tranquilo es peor
 * que un 403, porque el error se descubre el dia que hace falta.
 *
 * Solo salta cuando el valor CAMBIA de verdad: los formularios reenvian la
 * ficha entera, y negarse a guardar un telefono porque el cuerpo repite el rol
 * que ya tenia seria romper la pantalla por nada.
 */
export function assertCanChangeRoleOrBranch(
  actor: AuthenticatedActor,
  target: EditableAgent,
  next: { role?: Role; branchId?: string | null },
): void {
  const cambiaRol = next.role !== undefined && next.role !== target.role;
  const cambiaSede =
    next.branchId !== undefined && next.branchId !== target.branchId;
  if (!cambiaRol && !cambiaSede) return;

  if (actor.id === target.id) {
    throw new ForbiddenException(
      'Nadie cambia su propio perfil ni su propia sede: pídeselo a la administración',
    );
  }
  if ((actor.role as Role) !== Role.ADMIN) {
    throw new ForbiddenException(
      'Cambiar el perfil o la sede de alguien es cosa de la administración',
    );
  }
}
