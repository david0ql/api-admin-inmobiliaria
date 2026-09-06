import { parseAnalysisResponse } from './image-analysis.contract';
import { RoomKind } from './domain/image-analysis.enums';

/**
 * El validador tiene que ser BLANDO, y esto lo vigila.
 *
 * Cuando esto se ejecuta, la llamada al modelo ya esta pagada. Tirar la
 * respuesta entera de un lote de veinte fotos porque una clave venga mal es
 * tirar el dinero y dejar la pantalla en blanco sin que el asesor sepa por que.
 *
 * Y no es hipotetico: se anadio `address` a `privacy` tocando el `z.object` del
 * `pipe` pero no el `transform` que lo construye, y a partir de ahi TODOS los
 * analisis fallaron con 503 —"expected boolean, received undefined"— hasta que
 * alguien lo vio en un log. El fallo no estaba en el modelo ni en el prompt:
 * estaba en que un esquema pensado para no rechazar nada podia rechazarlo todo.
 *
 * Por eso estas pruebas van sobre la forma, no sobre valores concretos: lo que
 * se protege es la promesa de que ninguna respuesta razonable se pierde.
 */
describe('parseAnalysisResponse', () => {
  const imagenMinima = { index: 0 };

  it('acepta una respuesta completa', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        images: [
          {
            index: 0,
            room: 'KITCHEN',
            roomConfidence: 0.9,
            quality: 80,
            coverScore: 40,
            caption: 'Cocina integral',
            issues: ['Hay platos en el lavaplatos'],
            fixes: ['Recogerlos antes de la foto'],
            privacy: {
              faces: false,
              plates: false,
              documents: false,
              screens: false,
              address: true,
              notes: 'Se lee la nomenclatura en la fachada',
            },
            usable: true,
          },
        ],
        album: {
          suggestedOrder: [0],
          coverIndex: 0,
          missing: [],
          summary: 'Bien',
        },
      }),
    );
    expect(r.images[0].room).toBe(RoomKind.KITCHEN);
    expect(r.images[0].privacy.address).toBe(true);
  });

  /*
    El caso que rompio produccion: el modelo no menciona `address`. Tiene que
    caer a `false`, no tumbar el lote.
  */
  it('rellena a false cualquier bandera de privacidad que falte', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        images: [{ ...imagenMinima, privacy: { faces: true } }],
      }),
    );
    expect(r.images[0].privacy).toEqual({
      faces: true,
      plates: false,
      documents: false,
      screens: false,
      address: false,
      notes: null,
    });
  });

  it('sobrevive a que no venga `privacy` en absoluto', () => {
    const r = parseAnalysisResponse(JSON.stringify({ images: [imagenMinima] }));
    expect(r.images[0].privacy.faces).toBe(false);
    expect(r.images[0].usable).toBe(true);
  });

  it('normaliza una estancia que no existe en vez de fallar', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({ images: [{ ...imagenMinima, room: 'PATIO_TRASERO' }] }),
    );
    expect(r.images[0].room).toBe(RoomKind.OTHER);
  });

  it('recorta las puntuaciones fuera de rango', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        images: [
          { ...imagenMinima, quality: 105, coverScore: -20, roomConfidence: 3 },
        ],
      }),
    );
    expect(r.images[0].quality).toBe(100);
    expect(r.images[0].coverScore).toBe(0);
    expect(r.images[0].roomConfidence).toBe(1);
  });

  it('aguanta tipos equivocados en los campos de texto y lista', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        images: [
          {
            ...imagenMinima,
            caption: 42,
            issues: 'no es una lista',
            fixes: null,
          },
        ],
      }),
    );
    expect(r.images[0].caption).toBe('');
    expect(r.images[0].issues).toEqual([]);
    expect(r.images[0].fixes).toEqual([]);
  });

  it('quita el envoltorio de bloque de codigo que a veces anade el modelo', () => {
    const r = parseAnalysisResponse(
      '```json\n' + JSON.stringify({ images: [imagenMinima] }) + '\n```',
    );
    expect(r.images).toHaveLength(1);
  });

  it('rescata el objeto cuando el modelo le pone una frase delante', () => {
    const r = parseAnalysisResponse(
      'Claro, aqui tienes el analisis: ' +
        JSON.stringify({ images: [imagenMinima] }),
    );
    expect(r.images).toHaveLength(1);
  });

  /*
    Lo unico que SI debe fallar. Sin `images` no hay nada que guardar, y
    callarlo dejaria al asesor mirando una pantalla vacia sin explicacion.
  */
  it('falla cuando no hay ninguna imagen que guardar', () => {
    expect(() => parseAnalysisResponse('{"album":{}}')).toThrow();
    expect(() => parseAnalysisResponse('esto no es json')).toThrow();
  });

  it('ignora el `missing` del modelo: se calcula en codigo', () => {
    const r = parseAnalysisResponse(
      JSON.stringify({
        images: [imagenMinima],
        album: {
          suggestedOrder: [0],
          coverIndex: 0,
          missing: ['KITCHEN', 'BATHROOM'],
          summary: '',
        },
      }),
    );
    expect(r.album?.missing).toEqual([]);
  });
});
