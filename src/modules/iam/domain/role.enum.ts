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
 * Uno y solo uno: la administracion. El coordinador tambien ve "todo", pero
 * todo lo de SU sede, y el director dirige operaciones dentro de la suya: son
 * dos preguntas distintas —cuanto abarca dentro de una sede y cuantas sedes
 * abarca— y mezclarlas es como se cuelan las fugas entre oficinas.
 *
 * DIRECTOR estaba aqui y salio por decision del negocio: elegir sede y mirar
 * los datos de otra oficina es de la administracion. Salir de esta lista no le
 * cierra ninguna RUTA —el guard ya le da paso donde se pide MANAGER, por una
 * rama aparte— sino que le acota los DATOS, que es justo lo que se buscaba.
 *
 * Ojo si se crea uno: al no ver todas las sedes, necesita tener la suya
 * asignada. Sin ella, el interceptor contesta 403 en todas las peticiones.
 * `agents.service` ya la exige para los roles que no las ven todas, asi que el
 * formulario de alta lo pide solo.
 */
export const ROLES_ACROSS_BRANCHES: readonly Role[] = [Role.ADMIN];

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

/**
 * El escalafon, para responder a "¿este manda sobre este otro?".
 *
 * Existe solo para editar fichas de personas. El resto de permisos son por
 * alcance —cuanto ves dentro de una sede, cuantas sedes ves— y esas dos
 * preguntas no ordenan a nadie: un VIEWER de contabilidad ve la cartera
 * entera y no manda sobre nadie.
 *
 * VIEWER va con AGENT y no debajo: son dos perfiles distintos del mismo
 * escalon, y ponerlo mas abajo dejaria a un asesor reseteandole la contrasena
 * a contabilidad.
 */
const RANK: Record<Role, number> = {
  [Role.ADMIN]: 4,
  [Role.DIRECTOR]: 3,
  [Role.COORDINATOR]: 2,
  [Role.MANAGER]: 2,
  [Role.AGENT]: 1,
  [Role.VIEWER]: 1,
};

export function rankOf(role: Role): number {
  return RANK[role] ?? 0;
}

/**
 * Si `actor` esta por encima de `target` en el escalafon.
 *
 * Estricto a proposito: entre iguales no se editan. Sin esto, un director le
 * cambia la contrasena al administrador y entra como el —que es la via mas
 * corta que hay para subir de rango sin que nadie cambie ningun rol—.
 */
export function outranks(actor: Role, target: Role): boolean {
  return rankOf(actor) > rankOf(target);
}
