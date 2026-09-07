import {
  recorteAutomatico,
  resolverEncuadre,
  Via,
  type CorteSugerido,
  type EstadoFisico,
} from './framing';

/**
 * Lo que se vigila aqui es el REPARTO entre el modelo y el codigo, porque es
 * donde se decide si la propuesta sirve o estropea fotos.
 *
 * Los casos no son inventados: cada uno viene de una foto concreta del
 * inventario en la que se probo esto y se miro el resultado con la foto
 * delante. Se dice cual en cada prueba, porque dentro de un año la unica forma
 * de discutir un umbral es saber que foto lo puso ahi.
 */

const sano: EstadoFisico = {
  irrecuperable: false,
  pequena: false,
  noEsFoto: false,
};
const sinFranjas = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };

const corte = (borde: CorteSugerido['borde'], porcion = 10): CorteSugerido => ({
  borde,
  porcion,
  que: 'pared blanca',
});

describe('resolverEncuadre', () => {
  it('confirma el corte cuando el codigo mide franja y usa SU numero, no el del modelo', () => {
    // Alcoba con una pared muerta a la izquierda: el modelo dijo 15 y la franja
    // real medida era 45. Recortar 15 no habria cambiado nada.
    const r = resolverEncuadre(
      [corte('IZQUIERDA', 15)],
      { ...sinFranjas, izquierda: 45 },
      sano,
    );

    expect(r.via).toBe(Via.PROGRAMA);
    expect(r.cortes[0].auto).toBe(true);
    expect(r.cortes[0].porcion).toBe(15);
    expect(r.cortes[0].medido).toBe(45);
    // Se aplica lo medido, acotado al tope de un tercio.
    expect(recorteAutomatico(r)).toEqual({
      arriba: 0,
      abajo: 0,
      izquierda: 35,
      derecha: 0,
    });
  });

  it('deja en manos de una persona el corte que el codigo no confirma', () => {
    /*
      La alcoba montada: el modelo proponia recortar la derecha "pared blanca",
      pero lo que hay en ese borde es un espejo. El codigo mide 7 y no confirma.
      Aplicarlo mordia el espejo — es el caso que justifica todo este cruce.
    */
    const r = resolverEncuadre(
      [corte('DERECHA', 10)],
      { ...sinFranjas, derecha: 7 },
      sano,
    );

    expect(r.via).toBe(Via.ASESOR);
    expect(r.cortes[0].auto).toBe(false);
    // La propuesta NO se tira: se guarda para que alguien la lea y decida.
    expect(r.cortes).toHaveLength(1);
    expect(recorteAutomatico(r)).toBeNull();
  });

  it('no propone encuadre en una foto que hay que repetir', () => {
    // Bano de 501x675 movido: recortarlo no lo arregla, y decir "mejora el
    // encuadre" de una foto irrecuperable es hacer perder la tarde al asesor.
    const r = resolverEncuadre(
      [corte('DERECHA', 20)],
      { ...sinFranjas, derecha: 45 },
      { ...sano, irrecuperable: true },
    );

    expect(r.via).toBe(Via.REPETIR);
    expect(r.cortes).toEqual([]);
    expect(r.motivo).toContain('repetirla');
  });

  it('no propone recortar una foto que ya es mas pequeña de lo que pide la ficha', () => {
    const r = resolverEncuadre(
      [corte('ABAJO', 20)],
      { ...sinFranjas, abajo: 40 },
      { ...sano, pequena: true },
    );

    expect(r.via).toBe(Via.REPETIR);
    expect(r.cortes).toEqual([]);
  });

  it('no propone nada sobre el logo sobre fondo liso', () => {
    // El logo mide franja plana por los cuatro lados, asi que sin esta guarda
    // saldria "recortable". Hay 121 imagenes asi en el inventario.
    const r = resolverEncuadre(
      [corte('ARRIBA', 20)],
      { arriba: 43, abajo: 33, izquierda: 40, derecha: 40 },
      { ...sano, noEsFoto: true },
    );

    expect(r.via).toBe(Via.NADA);
    expect(r.cortes).toEqual([]);
  });

  it('la lista vacia es una respuesta valida y no una propuesta vacia', () => {
    const r = resolverEncuadre([], { ...sinFranjas, abajo: 40 }, sano);

    expect(r.via).toBe(Via.NADA);
    expect(r.cortes).toEqual([]);
    // El codigo mide franja abajo, pero el modelo no la señalo: no se recorta.
    // Lo liso no es lo inutil — el cielo de una terraza tambien sale liso.
    expect(recorteAutomatico(r)).toBeNull();
  });

  it('ignora el borde repetido, que no describe nada nuevo', () => {
    const r = resolverEncuadre(
      [corte('ABAJO', 10), corte('ABAJO', 30)],
      { ...sinFranjas, abajo: 40 },
      sano,
    );

    expect(r.cortes).toHaveLength(1);
    expect(r.cortes[0].porcion).toBe(10);
  });
});

describe('recorteAutomatico', () => {
  it('aplica UN solo borde, el mayor, aunque haya dos confirmados', () => {
    /*
      El pasillo de la 10040369: izquierda 26 % y derecha 35 %, los dos
      confirmados y los dos correctos por separado. Aplicando los dos a la vez
      se le quita el 61 % del ancho y el pasillo queda estrangulado en una tira
      — peor que la foto original. Se mira la foto y se ve.
    */
    const r = resolverEncuadre(
      [corte('IZQUIERDA', 10), corte('DERECHA', 15)],
      { ...sinFranjas, izquierda: 26, derecha: 35 },
      sano,
    );

    expect(r.via).toBe(Via.PROGRAMA);
    expect(r.cortes.filter((c) => c.auto)).toHaveLength(2);
    // Pero solo se ejecuta el mayor. El otro queda para que lo mire alguien.
    expect(recorteAutomatico(r)).toEqual({
      arriba: 0,
      abajo: 0,
      izquierda: 0,
      derecha: 35,
    });
  });

  it('no recorta cuando ningun corte esta confirmado', () => {
    const r = resolverEncuadre(
      [corte('ARRIBA', 30), corte('ABAJO', 30)],
      { arriba: 5, abajo: 8, izquierda: 0, derecha: 0 },
      sano,
    );

    expect(r.via).toBe(Via.ASESOR);
    expect(recorteAutomatico(r)).toBeNull();
  });
});
