import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { ImageMetrics } from './image-gate.rules';

/**
 * El revelado: lo que hace un fotografo con el negativo, no con la escena.
 *
 * Niveles, balance de blancos, un punto de gamma cuando la foto salio oscura y
 * el enfoque de salida que pide cualquier reduccion. Nada mas. No se inventa un
 * pixel, no se recorta, no se endereza y no se pinta un cielo: lo que se ve en
 * la foto revelada estaba en la foto.
 *
 * Los limites de aqui salen de medir 150 fotos del inventario y de MIRARLAS una
 * a una antes y despues. Cada tope esta donde esta porque bajarlo perdia mejora
 * visible o subirlo estropeaba una foto concreta; los numeros a secas no valen
 * para esto, porque una foto con mejor histograma se puede ver peor.
 */

/** Lo que se mide de la foto para decidir el revelado. */
export interface AnalisisTonal {
  /** Luminancia media 0-255. */
  brillo: number;
  /** Fraccion de pixeles por debajo de 24 y por encima de 246. */
  oscuros: number;
  claros: number;
  /** Luma del percentil 0,4 % y del 99,6 %: donde empieza y acaba la foto. */
  p004: number;
  p996: number;
  /**
   * Media RGB de las superficies claras y poco saturadas —pared, techo,
   * baldosa—, que es la referencia de blanco de la escena. Nula si no hay
   * bastantes: sin referencia no se toca el color.
   */
  blanco: { r: number; g: number; b: number } | null;
  /** Que parte de la imagen forma esa referencia. */
  blancoFraccion: number;
}

/** El revelado decidido para una foto. Es lo que se guarda y lo que se deshace. */
export interface Revelado {
  /** Version del criterio; sirve para rerevelar solo lo hecho con el viejo. */
  version: number;
  /** Estirado de niveles: `salida = g * entrada + b`. */
  niveles?: { g: number; b: number };
  /** Factores por canal del balance de blancos. */
  balance?: { r: number; g: number; b: number };
  /** Levantado de medios para las fotos que siguen oscuras tras los niveles. */
  gamma?: number;
  /**
   * Lo que se le hizo, redactado en español y listo para pintar.
   *
   * El texto sale de aqui y no del panel porque quien sabe que significan estos
   * numeros es este fichero: `g: 1.197` no es "+0,4 EV" ni ninguna otra cosa
   * que suene a camara, es una recta. Con los numeros crudos viajando solos, la
   * pantalla acabaria inventando una traduccion y diciendo algo distinto de lo
   * que hizo el codigo.
   *
   * Se guarda junto a los numeros, no en lugar de ellos: si un dia cambia la
   * redaccion, lo que decide sigue siendo `niveles`, `balance` y `gamma`.
   */
  resumen: string[];
}

/**
 * Sube cuando cambia el criterio, para poder rerevelar solo lo viejo.
 * 1: niveles + balance sobre superficies claras + gamma + enfoque de salida.
 */
export const REVELADO_VERSION = 1;

/**
 * Sigma del enfoque de salida.
 *
 * 0,5 y no 0,8: a 0,8 la foto de la pared de gotele salia crujiente, con el
 * grano de la pintura convertido en ruido. A 0,5 se gana la nitidez que pierde
 * cualquier reduccion y no se ve un solo halo en la muestra.
 */
const ENFOQUE_SIGMA = 0.5;

/** Ancho al que se analiza. Basta para histograma y color, y cuesta nada. */
const ANCHO_ANALISIS = 256;

const LIMITES = {
  /**
   * Ganancia maxima del estirado.
   *
   * A 1,25 la mejora era mayor en las fotos lavadas, pero un lavadero blanco
   * —paredes blancas, sin nada oscuro en la escena— salia gris sucio: el
   * "punto negro" de una habitacion blanca no es negro, es la esquina en
   * sombra. A 1,20 esa foto queda como estaba y las lavadas siguen ganando
   * casi todo.
   */
  ganancia: 1.2,
  /** Nunca se toma por negro un valor mas alto que este. */
  negro: 40,
  /** Ni por blanco uno mas bajo. */
  blanco: 200,
  /**
   * Cuanto puede oscurecer el revelado la media de la foto.
   *
   * El contraste se paga en luz, y en un inmueble la luz es lo que se vende:
   * una estancia clara que sale un 20 % mas oscura parece mas pequena. Si el
   * estirado se pasa de aqui, se le sube el suelo hasta cumplirlo.
   */
  bajada: 0.12,
  /** Fraccion minima de superficie clara neutra para fiarse del blanco. */
  refBlanco: 0.02,
  /**
   * Rango de dominante que se corrige.
   *
   * Por debajo de 1,04 no hay dominante que valga la pena; por encima de 1,5
   * lo que hay no es una dominante sino una escena de un color —un atardecer,
   * una sala con la luz encendida de noche— y neutralizarla es quitarle a la
   * foto lo que la hace.
   */
  castMin: 1.04,
  castMax: 1.5,
  /** La correccion nunca mueve un canal mas de un 7 %. */
  topeWB: 0.07,
  /** Se aplica amortiguada: se corrige el 70 % del camino, no el 100 %. */
  amortigua: 0.7,
};

@Injectable()
export class ImageDevelopService {
  /**
   * Mide lo que hace falta para revelar.
   *
   * No repite lo que ya sabe la puerta de calidad: `metrics` viene de
   * `ImageGateService.measure` cuando quien llama ya la ha pasado, y de ahi
   * salen brillo y colas de histograma, para que "esta oscura" signifique lo
   * mismo en el aviso al asesor y en el revelado. Lo que la puerta NO tiene
   * —mide en gris y sin percentiles— es el reparto por canal y donde empieza y
   * acaba de verdad la foto, y eso es justo lo que decide el revelado.
   */
  async analizar(
    buffer: Buffer,
    metrics?: ImageMetrics,
  ): Promise<AnalisisTonal> {
    const { data } = await sharp(buffer, { pages: 1 })
      .resize({ width: ANCHO_ANALISIS, fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hist = new Array<number>(256).fill(0);
    let n = 0;
    let suma = 0;
    let oscuros = 0;
    let claros = 0;
    let br = 0;
    let bg = 0;
    let bb = 0;
    let bn = 0;

    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const y = (r * 299 + g * 587 + b * 114) / 1000;
      const yi = y | 0;
      hist[yi]++;
      suma += y;
      n++;
      if (yi < 24) oscuros++;
      if (yi > 246) claros++;

      /*
        La referencia de blanco: pixeles claros y casi grises.

        El gris-mundo clasico —igualar las medias de los tres canales— falla
        justo en las fotos de esta agencia: una cocina de madera o un piso de
        terracota tiene mas rojo que verde por lo que hay, no por la luz, y
        corregirlo la deja azulada. Lo que si es neutro en un inmueble es la
        pared, el techo y la baldosa, y de ahi sale la referencia.
      */
      if (yi >= 140 && yi <= 248) {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx - mn <= 0.18 * mx) {
          br += r;
          bg += g;
          bb += b;
          bn++;
        }
      }
    }

    return {
      brillo: metrics?.brightness ?? suma / n,
      oscuros: metrics?.darkFraction ?? oscuros / n,
      claros: metrics?.brightFraction ?? claros / n,
      p004: percentil(hist, n, 0.004),
      p996: percentil(hist, n, 0.996),
      blanco: bn ? { r: br / bn, g: bg / bn, b: bb / bn } : null,
      blancoFraccion: bn / n,
    };
  }

  /**
   * Decide el revelado. Devuelve null cuando la foto no necesita nada.
   *
   * Ese null es la mitad del trabajo: aclarar una foto bien expuesta la
   * estropea, y el placeholder blanco de "sin imagen" —125 copias en el
   * inventario— no se toca porque no hay nada que revelar en el.
   */
  plan(a: AnalisisTonal): Revelado | null {
    const revelado: Revelado = { version: REVELADO_VERSION, resumen: [] };

    // --- niveles ---
    //
    // Si ya hay negro de sobra o blanco quemado, ese extremo no se toca: la
    // foto ya llega ahi y estirarla solo aplasta lo que quedaba.
    let lo = a.oscuros > 0.2 ? 0 : Math.min(a.p004, LIMITES.negro);
    let hi = a.claros > 0.1 ? 255 : Math.max(a.p996, LIMITES.blanco);
    if (hi <= lo) {
      lo = 0;
      hi = 255;
    }
    const g = acotar(255 / (hi - lo), 1, LIMITES.ganancia);
    let b = -lo * g;
    const minimo = a.brillo * (1 - LIMITES.bajada);
    if (g * a.brillo + b < minimo) b = minimo - g * a.brillo;

    /*
      Se comprueba cuanto mueve el estirado DONDE la foto tiene pixeles, no
      cuanto vale la ganancia.

      No es lo mismo: una foto entera en blanco —el placeholder de "sin
      imagen", una pared al sol— da una ganancia de 1,19 cuyo unico efecto es
      recortar por debajo de 40, donde no hay nada. Mirando solo la ganancia se
      reescriben las cuatro variantes de esa foto para dejarla igual, y encima
      se le marca version nueva en la URL, o sea que todo el que la tuviera en
      cache se la baja otra vez para no ver ninguna diferencia.
    */
    const mueve = Math.max(
      Math.abs(acotar(g * a.p004 + b, 0, 255) - a.p004),
      Math.abs(acotar(g * a.p996 + b, 0, 255) - a.p996),
      Math.abs(g * a.brillo + b - a.brillo),
    );
    if (mueve >= 3) {
      revelado.niveles = { g: redondear(g), b: redondear(b) };
    }

    // --- balance de blancos ---
    if (a.blanco && a.blancoFraccion >= LIMITES.refBlanco) {
      const { r, g: vg, b: vb } = a.blanco;
      const cast = Math.max(r, vg, vb) / Math.min(r, vg, vb);
      if (cast > LIMITES.castMin && cast < LIMITES.castMax) {
        const media = (r + vg + vb) / 3;
        const k = (canal: number) =>
          redondear(
            acotar(
              Math.pow(media / canal, LIMITES.amortigua),
              1 - LIMITES.topeWB,
              1 + LIMITES.topeWB,
            ),
          );
        revelado.balance = { r: k(r), g: k(vg), b: k(vb) };
      }
    }

    // --- medios ---
    //
    // Solo si DESPUES de los niveles la foto sigue oscura. Una foto a media
    // luz gana mas con el estirado que con la gamma, y aplicar las dos la deja
    // lavada.
    const tras =
      a.brillo * (revelado.niveles?.g ?? 1) + (revelado.niveles?.b ?? 0);
    if (tras < 100) {
      revelado.gamma = redondear(acotar(1 + (100 - tras) / 300, 1.02, 1.18));
    }

    if (!revelado.niveles && !revelado.balance && !revelado.gamma) return null;
    revelado.resumen = redactar(revelado);
    return revelado;
  }

  /**
   * Mete el revelado en un pipeline de sharp.
   *
   * Niveles y balance van en un solo `linear` por canal: son dos rectas
   * seguidas y componerlas evita una pasada entera sobre los pixeles y el
   * redondeo intermedio.
   */
  aplicar(pipe: sharp.Sharp, revelado: Revelado | null): sharp.Sharp {
    if (!revelado) return pipe;
    const g = revelado.niveles?.g ?? 1;
    const b = revelado.niveles?.b ?? 0;
    const k = revelado.balance;
    let salida = k
      ? pipe.linear([k.r * g, k.g * g, k.b * g], [k.r * b, k.g * b, k.b * b])
      : revelado.niveles
        ? pipe.linear(g, b)
        : pipe;
    if (revelado.gamma) salida = salida.gamma(revelado.gamma);
    return salida;
  }

  /**
   * Enfoque de salida. Se aplica SOLO cuando el paso reduce de verdad.
   *
   * Reducir una imagen promedia pixeles y por tanto emborrona: el enfoque de
   * salida devuelve el filo que quita la reduccion, no inventa detalle. Si el
   * paso no reduce —la foto ya venia a 1600 px—, enfocar solo anade halos.
   */
  enfoque(pipe: sharp.Sharp, reduce: boolean): sharp.Sharp {
    return reduce ? pipe.sharpen({ sigma: ENFOQUE_SIGMA }) : pipe;
  }
}

// --- calculo ----------------------------------------------------------------

function percentil(hist: number[], total: number, p: number): number {
  let acumulado = 0;
  const limite = total * p;
  for (let v = 0; v < 256; v++) {
    acumulado += hist[v];
    if (acumulado >= limite) return v;
  }
  return 255;
}

/**
 * El revelado en frases, para el panel.
 *
 * Se dice lo que se ve, no la formula: "+20 % de contraste" es lo que hace una
 * ganancia de 1,20, y nadie tiene que saber que hay una recta detras.
 */
function redactar(r: Revelado): string[] {
  const lineas: string[] = [];
  if (r.niveles) {
    lineas.push(
      `Niveles automaticos: +${Math.round((r.niveles.g - 1) * 100)} % de contraste`,
    );
  }
  if (r.balance) {
    const canales: [string, number][] = [
      ['rojo', r.balance.r],
      ['verde', r.balance.g],
      ['azul', r.balance.b],
    ];
    const movidos = canales
      // Por debajo del 1 % no se ve, y enumerarlo solo hace ruido.
      .filter(([, k]) => Math.abs(k - 1) >= 0.01)
      .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
      .map(
        ([nombre, k]) =>
          `${k > 1 ? '+' : '-'}${Math.round(Math.abs(k - 1) * 100)} % de ${nombre}`,
      );
    if (movidos.length) {
      lineas.push(`Balance de blancos: ${movidos.join(', ')}`);
    }
  }
  if (r.gamma) {
    lineas.push(`Medios levantados: +${Math.round((r.gamma - 1) * 100)} %`);
  }
  // El enfoque va siempre que hay revelado, y solo donde la foto se reduce.
  lineas.push('Enfoque de salida en los tamanos reducidos');
  return lineas;
}

function acotar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function redondear(v: number): number {
  return Math.round(v * 1000) / 1000;
}
