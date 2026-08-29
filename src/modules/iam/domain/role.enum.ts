/**
 * WASI solo distinguia ADMIN y REALTOR. Para operar la inmobiliaria como ERP
 * hacen falta dos escalones mas: un coordinador que ve todo el equipo sin poder
 * tocar la configuracion, y un perfil de solo lectura (contabilidad, auditoria).
 */
export enum Role {
  /** El dueño del sistema: todas las sedes y la configuracion. */
  ADMIN = 'ADMIN',
  /** Direccion de operaciones: ve todas las sedes, no toca la configuracion. */
  DIRECTOR = 'DIRECTOR',
  /** Manda en SU sede: su equipo, su inventario, sus clientes. */
  COORDINATOR = 'COORDINATOR',
  /** El nombre viejo de COORDINATOR. Se conserva por los tokens ya emitidos. */
  MANAGER = 'MANAGER',
  AGENT = 'AGENT',
  VIEWER = 'VIEWER',
}

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Roles que ven la cartera completa DE SU ALCANCE; el resto, solo lo propio. */
export const ROLES_WITH_FULL_VISIBILITY: readonly Role[] = [
  Role.ADMIN,
  Role.DIRECTOR,
  Role.COORDINATOR,
  Role.MANAGER,
  Role.VIEWER,
];

/**
 * Quien ve TODAS las sedes.
 *
 * Son dos y solo dos. El coordinador tambien ve "todo", pero todo lo de SU
 * sede: son dos preguntas distintas —cuanto abarca dentro de una sede y
 * cuantas sedes abarca— y mezclarlas es como se cuelan las fugas de datos
 * entre oficinas.
 */
export const ROLES_ACROSS_BRANCHES: readonly Role[] = [
  Role.ADMIN,
  Role.DIRECTOR,
];

export function seesAllBranches(role: Role): boolean {
  return ROLES_ACROSS_BRANCHES.includes(role);
}

/** Manda dentro de una sede: crea usuarios y toca el inventario de todos. */
export function runsBranch(role: Role): boolean {
  return (
    role === Role.COORDINATOR || role === Role.MANAGER || role === Role.ADMIN
  );
}

export function seesEverything(role: Role): boolean {
  return ROLES_WITH_FULL_VISIBILITY.includes(role);
}

/** Puede escribir sobre registros que no le pertenecen. */
export function canWriteAcrossTeam(role: Role): boolean {
  return (
    role === Role.ADMIN ||
    role === Role.DIRECTOR ||
    role === Role.COORDINATOR ||
    role === Role.MANAGER
  );
}
