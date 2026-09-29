import { Role } from '../iam/domain/role.enum';

/**
 * Quien ve que embudo.
 *
 * La regla vive en SQL —un embudo que no se puede ver no debe viajar por la
 * red— y por eso lo que se prueba aqui es la DECISION, no la consulta: dado un
 * usuario y un embudo, ¿deberia verlo? Si alguien cambia la consulta y se le
 * olvida uno de estos casos, el sintoma en produccion no es un error: es un
 * asesor de Cabecera mirando el embudo de captacion de Cañaveral.
 */
function loVe(
  actor: { role: Role; branchId: string | null },
  embudo: { branchId: string | null; visibleRoles: string[] },
  sedeElegida: string | null = null,
): boolean {
  const veTodas = actor.role === Role.ADMIN || actor.role === Role.DIRECTOR;
  if (veTodas) {
    if (!sedeElegida) return true;
    return embudo.branchId === sedeElegida || embudo.branchId === null;
  }
  const deSuSede =
    embudo.branchId === actor.branchId || embudo.branchId === null;
  const deSuPerfil =
    embudo.visibleRoles.length === 0 || embudo.visibleRoles.includes(actor.role);
  return deSuSede && deSuPerfil;
}

const CABECERA = 'sede-1';
const CANAVERAL = 'sede-2';

describe('visibilidad de los embudos', () => {
  const asesor = { role: Role.AGENT, branchId: CABECERA };

  it('un asesor no ve el embudo de otra sede', () => {
    expect(loVe(asesor, { branchId: CANAVERAL, visibleRoles: [] })).toBe(false);
  });

  it('un asesor ve los de su sede', () => {
    expect(loVe(asesor, { branchId: CABECERA, visibleRoles: [] })).toBe(true);
  });

  it('un embudo sin sede es de toda la empresa', () => {
    expect(loVe(asesor, { branchId: null, visibleRoles: [] })).toBe(true);
  });

  it('sin perfiles nombrados, lo ve todo el mundo', () => {
    // Es el caso de los tres embudos que ya existian: al migrar no se recorto
    // nada, y una lista vacia tiene que seguir significando "para todos".
    expect(loVe(asesor, { branchId: null, visibleRoles: [] })).toBe(true);
  });

  it('con perfiles nombrados, solo los nombrados', () => {
    const soloCoordinacion = { branchId: CABECERA, visibleRoles: [Role.COORDINATOR] };
    expect(loVe(asesor, soloCoordinacion)).toBe(false);
    expect(
      loVe({ role: Role.COORDINATOR, branchId: CABECERA }, soloCoordinacion),
    ).toBe(true);
  });

  it('la administracion ve todos, incluidos los que no le nombran', () => {
    // Si no viera los embudos que reparte, no podria repartirlos.
    const admin = { role: Role.ADMIN, branchId: null };
    expect(loVe(admin, { branchId: CANAVERAL, visibleRoles: [Role.AGENT] })).toBe(true);
  });

  it('la administracion, con una sede elegida, ve la suya y los de empresa', () => {
    const admin = { role: Role.ADMIN, branchId: null };
    expect(loVe(admin, { branchId: CABECERA, visibleRoles: [] }, CABECERA)).toBe(true);
    expect(loVe(admin, { branchId: null, visibleRoles: [] }, CABECERA)).toBe(true);
    expect(loVe(admin, { branchId: CANAVERAL, visibleRoles: [] }, CABECERA)).toBe(false);
  });
});
