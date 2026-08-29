import { ForbiddenException } from '@nestjs/common';
import { Role } from './domain/role.enum';
import {
  assertCanChangeRoleOrBranch,
  assertCanCreateAgent,
  assertCanEditAgent,
  type EditableAgent,
} from './scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * La matriz de quien edita a quien, escrita como prueba.
 *
 * Es la unica parte de este modulo que se prueba sola, y a proposito: el resto
 * son consultas que se ven fallar en pantalla, pero un permiso de mas no se ve
 * — funciona igual de bien hasta el dia que alguien lee la ficha de otra sede.
 */

const SEDE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SEDE_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function actor(role: Role, branchId: string | null, id = `${role}-1`) {
  return {
    id,
    email: `${role}@serrano.test`,
    role,
    fullName: role,
    mustSetPassword: false,
    branchId,
  } satisfies AuthenticatedActor;
}

function ficha(role: Role, branchId: string | null, id = `${role}-2`) {
  return { id, role, branchId } satisfies EditableAgent;
}

const puede = (a: AuthenticatedActor, t: EditableAgent) => {
  try {
    assertCanEditAgent(a, t);
    return true;
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return false;
  }
};

describe('assertCanEditAgent', () => {
  it('cada uno edita su propia ficha, sea cual sea su perfil', () => {
    for (const role of [Role.AGENT, Role.VIEWER, Role.COORDINATOR]) {
      const yo = actor(role, SEDE_A, 'mismo-id');
      expect(puede(yo, ficha(role, SEDE_A, 'mismo-id'))).toBe(true);
    }
  });

  it('el administrador edita a cualquiera, incluido otro administrador', () => {
    const admin = actor(Role.ADMIN, null);
    expect(puede(admin, ficha(Role.AGENT, SEDE_B))).toBe(true);
    expect(puede(admin, ficha(Role.DIRECTOR, null))).toBe(true);
    expect(puede(admin, ficha(Role.ADMIN, null))).toBe(true);
  });

  it('la direccion llega a todas las sedes pero no a la administracion', () => {
    const director = actor(Role.DIRECTOR, null);
    expect(puede(director, ficha(Role.AGENT, SEDE_A))).toBe(true);
    expect(puede(director, ficha(Role.COORDINATOR, SEDE_B))).toBe(true);
    // Si pudiera, le cambiaria la contrasena al administrador y entraria como
    // el: ascender sin que nadie cambie ningun rol.
    expect(puede(director, ficha(Role.ADMIN, null))).toBe(false);
    expect(puede(director, ficha(Role.DIRECTOR, null))).toBe(false);
  });

  it('quien manda en una sede solo llega a los suyos', () => {
    const coord = actor(Role.COORDINATOR, SEDE_A);
    expect(puede(coord, ficha(Role.AGENT, SEDE_A))).toBe(true);
    expect(puede(coord, ficha(Role.VIEWER, SEDE_A))).toBe(true);
    expect(puede(coord, ficha(Role.AGENT, SEDE_B))).toBe(false);
    expect(puede(coord, ficha(Role.COORDINATOR, SEDE_A))).toBe(false);
    // Sin sede significa administracion o direccion, no "de cualquier sede".
    expect(puede(coord, ficha(Role.ADMIN, null))).toBe(false);
    expect(puede(coord, ficha(Role.DIRECTOR, null))).toBe(false);
  });

  it('MANAGER es COORDINATOR con el nombre viejo', () => {
    const manager = actor(Role.MANAGER, SEDE_A);
    expect(puede(manager, ficha(Role.AGENT, SEDE_A))).toBe(true);
    expect(puede(manager, ficha(Role.AGENT, SEDE_B))).toBe(false);
  });

  it('un asesor no edita a nadie mas que a si mismo', () => {
    const asesor = actor(Role.AGENT, SEDE_A);
    expect(puede(asesor, ficha(Role.AGENT, SEDE_A))).toBe(false);
    expect(puede(asesor, ficha(Role.VIEWER, SEDE_A))).toBe(false);
    expect(puede(asesor, ficha(Role.ADMIN, null))).toBe(false);
  });
});

describe('assertCanChangeRoleOrBranch', () => {
  const admin = actor(Role.ADMIN, null);
  const coord = actor(Role.COORDINATOR, SEDE_A);
  const asesor = ficha(Role.AGENT, SEDE_A);

  const intenta = (
    a: AuthenticatedActor,
    t: EditableAgent,
    next: { role?: Role; branchId?: string | null },
  ) => {
    try {
      assertCanChangeRoleOrBranch(a, t, next);
      return true;
    } catch {
      return false;
    }
  };

  it('deja pasar lo que no cambia nada: el formulario reenvia la ficha entera', () => {
    expect(intenta(coord, asesor, {})).toBe(true);
    expect(intenta(coord, asesor, { role: Role.AGENT, branchId: SEDE_A })).toBe(
      true,
    );
  });

  it('solo la administracion mueve el perfil o la sede de otro', () => {
    expect(intenta(admin, asesor, { role: Role.COORDINATOR })).toBe(true);
    expect(intenta(admin, asesor, { branchId: SEDE_B })).toBe(true);
    expect(intenta(coord, asesor, { role: Role.COORDINATOR })).toBe(false);
    expect(intenta(coord, asesor, { branchId: SEDE_B })).toBe(false);
  });

  it('nadie se sube el rango a si mismo, ni siquiera el administrador', () => {
    const yo = actor(Role.AGENT, SEDE_A, 'mismo-id');
    const miFicha = ficha(Role.AGENT, SEDE_A, 'mismo-id');
    expect(intenta(yo, miFicha, { role: Role.ADMIN })).toBe(false);
    expect(intenta(yo, miFicha, { branchId: SEDE_B })).toBe(false);

    const soyAdmin = actor(Role.ADMIN, null, 'admin-id');
    expect(
      intenta(soyAdmin, ficha(Role.ADMIN, null, 'admin-id'), {
        branchId: SEDE_A,
      }),
    ).toBe(false);
  });
});

describe('assertCanCreateAgent', () => {
  const crea = (a: AuthenticatedActor, role: Role) => {
    try {
      assertCanCreateAgent(a, role);
      return true;
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      return false;
    }
  };

  it('el administrador da de alta cualquier perfil', () => {
    const admin = actor(Role.ADMIN, null);
    for (const role of [
      Role.ADMIN,
      Role.DIRECTOR,
      Role.COORDINATOR,
      Role.AGENT,
      Role.VIEWER,
    ]) {
      expect(crea(admin, role)).toBe(true);
    }
  });

  it('la direccion crea por debajo de si misma, nunca a su altura ni por encima', () => {
    const director = actor(Role.DIRECTOR, null);
    expect(crea(director, Role.COORDINATOR)).toBe(true);
    expect(crea(director, Role.AGENT)).toBe(true);
    expect(crea(director, Role.VIEWER)).toBe(true);
    expect(crea(director, Role.DIRECTOR)).toBe(false);
    expect(crea(director, Role.ADMIN)).toBe(false);
  });

  it('quien manda en una sede solo da de alta asesores y consulta', () => {
    for (const rol of [Role.COORDINATOR, Role.MANAGER]) {
      const jefe = actor(rol, SEDE_A);
      expect(crea(jefe, Role.AGENT)).toBe(true);
      expect(crea(jefe, Role.VIEWER)).toBe(true);
      // Un complice con su mismo rango, o con mas, es justo lo que no puede
      // fabricarse.
      expect(crea(jefe, Role.COORDINATOR)).toBe(false);
      expect(crea(jefe, Role.MANAGER)).toBe(false);
      expect(crea(jefe, Role.DIRECTOR)).toBe(false);
      expect(crea(jefe, Role.ADMIN)).toBe(false);
    }
  });

  it('un asesor o un perfil de consulta no dan de alta a nadie', () => {
    for (const rol of [Role.AGENT, Role.VIEWER]) {
      const nadie = actor(rol, SEDE_A);
      for (const role of [
        Role.ADMIN,
        Role.DIRECTOR,
        Role.COORDINATOR,
        Role.AGENT,
        Role.VIEWER,
      ]) {
        expect(crea(nadie, role)).toBe(false);
      }
    }
  });
});
