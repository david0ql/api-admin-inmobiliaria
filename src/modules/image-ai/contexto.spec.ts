import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageAnalysisService } from './image-analysis.service';
import { DEFAULT_INVENTORY_RULES } from '../media/image-gate.rules';
import type { ImageMetrics } from '../media/image-gate.rules';

/**
 * Que el modelo reciba de verdad lo que el prompt le promete.
 *
 * El prompt tiene una seccion entera —"Lo que NO tienes que juzgar"— que le
 * dice al modelo: «la resolucion, la orientacion, la nitidez y la exposicion ya
 * se han medido con codigo y te llegan escritas junto a cada imagen». Durante
 * toda la primera version del modulo eso era MENTIRA: `contexto()` solo mandaba
 * el tamano. El modelo opinaba sobre si una foto estaba movida porque nadie le
 * habia dicho lo contrario, y encima invalidó parte de una tanda de mediciones
 * hechas sobre esa premisa.
 *
 * No fallaba nada. No habia error, ni excepcion, ni prueba en rojo: solo un
 * analisis peor y una seccion del prompt gobernando el vacio. Es la misma forma
 * exacta que el "validador blando" que prometia en su cabecera no descartar
 * nada mientras cualquier campo ausente tumbaba el lote.
 *
 * De ahi la leccion que sujeta este fichero: **un prompt es codigo en cuanto
 * afirma algo sobre el sistema**, y una afirmacion sin una prueba que la sujete
 * dura hasta que alguien la cruza con el emisor. La idea de escribir esto es de
 * `ia-prompt-lab`, que fue quien redacto esa frase del prompt y quien la dio
 * por cierta sin mirar `contexto()`.
 *
 * Se prueban metodos privados a proposito: lo que importa no es la forma de la
 * funcion, es el TEXTO que sale del proceso hacia el modelo. Exponerlos solo
 * para poder mirarlos seria empeorar el diseno para poder probarlo.
 */
describe('el contexto que se le manda al modelo', () => {
  /** Una foto con las metricas que se le pongan; lo demas no lo mira `linea`. */
  const foto = (metricas: Partial<ImageMetrics> | null, width = 2000) =>
    ({
      image: { width, height: Math.round(width / 1.5), isMain: false },
      buffer: Buffer.alloc(0),
      metricas: metricas
        ? {
            width,
            height: Math.round(width / 1.5),
            aspectRatio: 1.5,
            megapixels: 3,
            bytes: 100_000,
            format: 'webp',
            sharpness: 500,
            brightness: 140,
            darkFraction: 0.01,
            brightFraction: 0.01,
            perceptualHash: '',
            checksum: '',
            ...metricas,
          }
        : null,
      franjas: { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 },
    }) as never;

  // `linea` no toca estado del servicio: se puede instanciar sin dependencias.
  const servicio = new ImageAnalysisService(
    ...(Array(8).fill(null) as []),
  ) as unknown as {
    linea: (i: number, c: never, r: typeof DEFAULT_INVENTORY_RULES) => string;
  };
  const linea = (c: never) => servicio.linea(0, c, DEFAULT_INVENTORY_RULES);

  it('manda el tamano y la orientacion', () => {
    expect(linea(foto(null, 2000))).toContain('2000x1333');
    expect(linea(foto(null, 2000))).toContain('horizontal');
  });

  /*
    El caso que estuvo roto: sin esto, el modelo no sabia que la nitidez ya
    estaba medida y opinaba igualmente.
  */
  it('dice que esta movida cuando la nitidez esta por debajo del umbral', () => {
    expect(linea(foto({ sharpness: 10 }))).toContain('movida');
  });

  it('dice que esta oscura, y NO que esta movida, cuando lo que pasa es que esta oscura', () => {
    // Una foto a oscuras pierde contraste y su laplaciano se hunde: las dos
    // condiciones se cumplen a la vez y solo una es la causa.
    const l = linea(foto({ brightness: 20, sharpness: 10 }));
    expect(l).toContain('oscura');
    expect(l).not.toContain('movida');
  });

  it('dice que esta quemada de luces', () => {
    expect(linea(foto({ brightness: 240 }))).toContain('quemada');
  });

  it('avisa de la resolucion por debajo del minimo', () => {
    expect(linea(foto({ width: 640 }, 640))).toContain('POR DEBAJO');
  });

  it('no inventa defectos en una foto sana', () => {
    const l = linea(foto({}));
    expect(l).not.toContain('movida');
    expect(l).not.toContain('oscura');
    expect(l).not.toContain('quemada');
    expect(l).not.toContain('POR DEBAJO');
  });

  /*
    El cruce que de verdad cierra el agujero: si el prompt sigue prometiendo
    esos datos, tienen que salir de aqui. Si alguien quita una metrica del
    contexto sin quitarla del prompt, esto se pone en rojo.
  */
  it('lo que el prompt promete es lo que el contexto manda', () => {
    const prompt = readFileSync(
      join(__dirname, 'defaults', 'analisis-imagenes.md'),
      'utf8',
    ).toLowerCase();

    const promesas: [string, string, () => string][] = [
      ['resolucion', 'POR DEBAJO', () => linea(foto({ width: 640 }, 640))],
      ['orientacion', 'horizontal', () => linea(foto(null))],
      ['nitidez', 'movida', () => linea(foto({ sharpness: 10 }))],
      ['exposicion', 'oscura', () => linea(foto({ brightness: 20 }))],
    ];

    for (const [promete, senal, generar] of promesas) {
      if (!prompt.includes(promete)) continue; // ya no lo promete: nada que sujetar
      expect(generar()).toContain(senal);
    }
  });
});
