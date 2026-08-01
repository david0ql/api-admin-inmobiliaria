/**
 * WASI solo distinguia ADMIN y REALTOR. Para operar la inmobiliaria como ERP
 * hacen falta dos escalones mas: un coordinador que ve todo el equipo sin poder
 * tocar la configuracion, y un perfil de solo lectura (contabilidad, auditoria).
 */
export enum Role {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  AGENT = 'AGENT',
  VIEWER = 'VIEWER',
}

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Roles que ven la cartera completa; el resto queda acotado a lo propio. */
export const ROLES_WITH_FULL_VISIBILITY: readonly Role[] = [
  Role.ADMIN,
  Role.MANAGER,
  Role.VIEWER,
];

export function seesEverything(role: Role): boolean {
  return ROLES_WITH_FULL_VISIBILITY.includes(role);
}

/** Puede escribir sobre registros que no le pertenecen. */
export function canWriteAcrossTeam(role: Role): boolean {
  return role === Role.ADMIN || role === Role.MANAGER;
}
