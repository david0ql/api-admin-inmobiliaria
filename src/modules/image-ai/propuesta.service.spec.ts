import { PropuestaService } from './propuesta.service';
import { Via, type Encuadre } from './framing';
import type { ImageAnalysis } from './domain/image-analysis.entity';

/**
 * Lo que se vigila aqui es `destino`, y solo eso importa de verdad.
 *
 * La pantalla del panel se parte en dos bloques por ese campo: uno con un boton
 * que arregla la foto y otro con una lista que alguien se lleva al movil para ir
 * a la casa. Meter algo en el cubo equivocado no da ningun error —se pinta tan
 * tranquilo— y significa prometerle a un asesor que un boton arregla algo que
 * solo se arregla volviendo con la camara.
 */

const analisis = (parcial: Partial<ImageAnalysis>): ImageAnalysis =>
  ({
    id: 'a1',
    propertyImageId: 'i1',
    fixes: [],
    issues: [],
    usable: true,
    framing: null,
    metrics: null,
    createdAt: new Date('2026-09-06T20:00:00Z'),
    ...parcial,
  }) as ImageAnalysis;

const encuadre = (e: Partial<Encuadre>): Encuadre => ({
  via: Via.PROGRAMA,
  cortes: [],
  motivo: null,
  ...e,
});

/** Se prueba la traduccion, que es pura: no hace falta ni base ni modelo. */
const traducir = (a: ImageAnalysis) =>
  (
    new PropuestaService(null as never) as unknown as {
      deAnalisis(a: ImageAnalysis): {
        metricas: unknown;
        sugerencias: {
          destino: string;
          codigo: string;
          titulo: string;
          id: string;
          severidad: string;
        }[];
      };
    }
  ).deAnalisis(a);

describe('el reparto entre los dos bloques del panel', () => {
  it('un recorte confirmado por el codigo va a AUTO, con el numero medido', () => {
    const r = traducir(
      analisis({
        framing: encuadre({
          cortes: [
            {
              borde: 'ABAJO',
              porcion: 20,
              medido: 35,
              que: 'suelo vacio',
              auto: true,
            },
          ],
        }),
      }),
    );

    expect(r.sugerencias).toHaveLength(1);
    expect(r.sugerencias[0].destino).toBe('AUTO');
    expect(r.sugerencias[0].codigo).toBe('SUELO');
    // El 35 medido, no el 20 que estimo el modelo.
    expect(r.sugerencias[0].titulo).toContain('35 %');
    expect(r.sugerencias[0].titulo).not.toContain('20 %');
  });

  it('nunca anuncia un recorte mayor que el que el sistema va a aplicar', () => {
    /*
      La franja medida puede pasar del tope de un solo borde. Antes se
      anunciaba "recortar un 45 %" y el boton recortaba un 35: el titulo
      prometia una cosa y el sistema hacia otra.
    */
    const r = traducir(
      analisis({
        framing: encuadre({
          cortes: [
            {
              borde: 'IZQUIERDA',
              porcion: 15,
              medido: 45,
              que: 'pared',
              auto: true,
            },
          ],
        }),
      }),
    );

    expect(r.sugerencias[0].titulo).toContain('35 %');
    expect(r.sugerencias[0].titulo).not.toContain('45 %');
  });

  it('un recorte SIN confirmar nunca llega a AUTO', () => {
    /*
      Es el caso de la alcoba montada: el modelo pedia recortar la derecha
      "pared blanca" y lo que hay ahi es un espejo. Con un boton detras, ese
      recorte se aplica solo y estropea la foto.
    */
    const r = traducir(
      analisis({
        framing: encuadre({
          via: Via.ASESOR,
          cortes: [
            {
              borde: 'DERECHA',
              porcion: 10,
              medido: 7,
              que: 'pared blanca',
              auto: false,
            },
          ],
        }),
      }),
    );

    expect(r.sugerencias[0].destino).toBe('REVISITA');
    expect(r.sugerencias[0].titulo).toContain('Quiza');
  });

  it('una tarea del asesor va SIEMPRE a REVISITA, diga lo que diga el modelo', () => {
    // `fixes` es texto libre: aunque el modelo escriba "recortar", ninguna
    // frase de esa lista se ejecuta tocando el archivo.
    const r = traducir(
      analisis({
        fixes: ['Quitar el plastico de las sillas', 'recortar la foto'],
      }),
    );

    expect(r.sugerencias.map((s) => s.destino)).toEqual([
      'REVISITA',
      'REVISITA',
    ]);
  });

  it('una foto que hay que repetir es REVISITA y alta, y no propone recorte', () => {
    const r = traducir(
      analisis({
        framing: encuadre({
          via: Via.REPETIR,
          cortes: [],
          motivo: 'La foto esta movida',
        }),
      }),
    );

    expect(r.sugerencias).toHaveLength(1);
    expect(r.sugerencias[0].destino).toBe('REVISITA');
    expect(r.sugerencias[0].codigo).toBe('MOVIDA');
    expect(r.sugerencias[0].severidad).toBe('ALTA');
  });

  it('sin propuesta guardada no inventa sugerencias', () => {
    expect(traducir(analisis({})).sugerencias).toEqual([]);
  });

  it('el id es estable entre dos lecturas', () => {
    const a = analisis({
      framing: encuadre({
        cortes: [
          { borde: 'ABAJO', porcion: 20, medido: 35, que: 'suelo', auto: true },
        ],
      }),
      fixes: ['Abrir las cortinas'],
    });

    expect(traducir(a).sugerencias.map((s) => s.id)).toEqual(
      traducir(a).sugerencias.map((s) => s.id),
    );
    expect(traducir(a).sugerencias.map((s) => s.id)).toEqual([
      'a1:recorte:ABAJO',
      'a1:tarea:0',
    ]);
  });
});

describe('las metricas que se enseñan al lado de la frase', () => {
  it('salen de lo que midio la puerta', () => {
    const r = traducir(
      analisis({
        metrics: {
          width: 2528,
          height: 1696,
          aspectRatio: 1.49,
          sharpness: 63.4,
          brightness: 141,
        },
      }),
    );

    expect(r.metricas).toEqual({
      anchura: 2528,
      altura: 1696,
      aspecto: 1.49,
      nitidez: 63.4,
      brillo: 141,
    });
  });

  it('sin medidas devuelve null en vez de ceros, que se leerian como un dato', () => {
    expect(traducir(analisis({ metrics: null })).metricas).toBeNull();
    expect(traducir(analisis({ metrics: { bytes: 100 } })).metricas).toBeNull();
  });

  it('calcula el aspecto cuando el analisis es viejo y no lo trae', () => {
    const r = traducir(analisis({ metrics: { width: 800, height: 600 } })) as {
      metricas: { aspecto: number; nitidez: number | null };
    };

    expect(r.metricas.aspecto).toBe(1.33);
    // Lo que no se midio va a null, no a 0: un 0 se leeria como "sin nitidez".
    expect(r.metricas.nitidez).toBeNull();
  });
});
