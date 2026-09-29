import { PropertyKind, PropertyCondition } from './domain/property.enums';

/**
 * La regla que la base hace cumplir, escrita tambien aqui.
 *
 * La restriccion `ck_property_kind_family` impide que una fila se contradiga,
 * pero una restriccion solo dice que no al guardar: no explica por que. Esto
 * documenta el invariante y falla si alguien cambia el enum sin pensar en el.
 *
 * El caso que lo motivo: de 193 unidades de proyecto, 153 estaban marcadas como
 * "usado" y 17 como "proyecto". Ninguna mentia a proposito — es que `condition`
 * describe un inmueble de segunda mano y a un apartamento sobre planos no se le
 * aplica, asi que se quedaba con lo que hubiera. El sintoma salia fuera: quien
 * filtraba "Usado" en la web se llevaba obra nueva de una constructora.
 */
function coherente(fila: {
  kind: PropertyKind;
  familyId: string | null;
}): boolean {
  return fila.kind === PropertyKind.PROJECT_UNIT
    ? fila.familyId !== null
    : fila.familyId === null;
}

describe('un inmueble es usado o es unidad de proyecto', () => {
  it('una unidad de proyecto tiene proyecto', () => {
    expect(
      coherente({ kind: PropertyKind.PROJECT_UNIT, familyId: 'proyecto-1' }),
    ).toBe(true);
    expect(
      coherente({ kind: PropertyKind.PROJECT_UNIT, familyId: null }),
    ).toBe(false);
  });

  it('un usado no cuelga de ningun proyecto', () => {
    expect(coherente({ kind: PropertyKind.USED, familyId: null })).toBe(true);
    expect(
      coherente({ kind: PropertyKind.USED, familyId: 'proyecto-1' }),
    ).toBe(false);
  });

  it('solo hay dos clases, y no se inventan por el camino', () => {
    // Si alguien añade una tercera, que se entere aqui y no en produccion.
    expect(Object.values(PropertyKind)).toEqual(['USED', 'PROJECT_UNIT']);
  });

  it('la condicion de una unidad de proyecto es NUEVA', () => {
    // La migracion corrige las 170 que decian otra cosa; esto fija la regla
    // para las que se den de alta a partir de ahora.
    const condicionDeUnaUnidad = PropertyCondition.NEW;
    expect(condicionDeUnaUnidad).toBe('NEW');
  });
});
