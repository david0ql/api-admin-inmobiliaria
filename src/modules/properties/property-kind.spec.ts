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

  it('estar agrupado NO dice si es nuevo o usado', () => {
    /*
      Esta prueba existe por un fallo que llego a produccion.

      Habia una version que ponia `condition = NEW` a todo lo que colgara de un
      proyecto, razonando que una unidad que entrega una constructora es obra
      nueva. La premisa no describia esta base: los 57 "proyectos" son
      edificios ya entregados y lo que agrupan son 153 apartamentos de segunda
      mano. Resultado: 170 fichas mal marcadas y un filtro Nuevo/Usado que
      devolvia lo contrario de lo que se le pedia.

      Las dos cosas son independientes, y aqui se deja escrito.
    */
    const usadoEnUnConjunto = {
      kind: PropertyKind.PROJECT_UNIT,
      familyId: 'conjunto-1',
      condition: PropertyCondition.USED,
    };
    expect(coherente(usadoEnUnConjunto)).toBe(true);

    const nuevoSuelto = {
      kind: PropertyKind.USED,
      familyId: null,
      condition: PropertyCondition.NEW,
    };
    expect(coherente(nuevoSuelto)).toBe(true);
  });
});
