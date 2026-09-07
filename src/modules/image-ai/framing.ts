import type { DeadBands } from '../media/image-gate.rules';

/**
 * La propuesta de encuadre: que se le haria a la foto para que se vea mejor.
 *
 * Existe porque el juicio que ya habia —esta bien, esta mal, falta la cocina—
 * no le dice al asesor QUE hacer. "Mejorar el encuadre" no es una instruccion;
 * "recortar la cuarta parte de abajo, que es suelo vacio" si lo es.
 *
 * Y esta partido en dos destinatarios a proposito, porque son dos trabajos
 * distintos: lo que se arregla tocando el archivo lo puede hacer un programa,
 * y lo que se arregla volviendo a la casa lo tiene que hacer una persona.
 * Mezclarlos es lo que hace que el asesor deje de leer: si en la misma lista
 * le dicen "recorta abajo" y "quita el plastico de las sillas", la lista no es
 * de nadie.
 *
 * Lo que NO entra aqui: exposicion, balance de blancos, gamma y enfoque. Eso lo
 * hace ya el revelado automatico (`ImageDevelopService`) en toda foto que
 * entra, sin que nadie lo pida, y proponer lo que el sistema ya hizo solo es
 * ruido. Aqui va lo que el revelado explicitamente no toca: el encuadre.
 */

/** Los cuatro bordes, como los nombra el modelo. */
export const BORDES = ['ARRIBA', 'ABAJO', 'IZQUIERDA', 'DERECHA'] as const;
export type Borde = (typeof BORDES)[number];

/** De que borde de `DeadBands` habla cada uno. */
const CLAVE: Record<Borde, keyof DeadBands> = {
  ARRIBA: 'arriba',
  ABAJO: 'abajo',
  IZQUIERDA: 'izquierda',
  DERECHA: 'derecha',
};

/** Lo que el modelo propone recortar de un borde. */
export interface CorteSugerido {
  borde: Borde;
  /** Lo que estima el modelo, en porcentaje. No se ejecuta nunca: ver `auto`. */
  porcion: number;
  /** Que hay en ese borde, en sus palabras. Es lo que el asesor puede rebatir. */
  que: string;
}

/** Un corte ya contrastado con lo que mide el codigo. */
export interface Corte extends CorteSugerido {
  /** Lo que mide el codigo de franja plana en ese mismo borde. */
  medido: number;
  /**
   * Lo que de verdad se va a recortar: lo medido, acotado a lo que cabe sin
   * que la web vuelva a recortar. Es el numero que hay que enseñar y aplicar;
   * `medido` queda para poder explicar por que no se recorta todo.
   */
  aplicable: number;
  /**
   * El codigo confirma la franja y el corte se puede aplicar sin que nadie lo
   * mire. Cuando es false la propuesta sigue en pie, pero la ejecuta —o la
   * descarta— una persona.
   */
  auto: boolean;
}

/**
 * A quien le toca arreglar esta foto. Es el campo por el que se ordena la
 * pantalla: separa el trabajo que hace el sistema del que hace una persona.
 */
export enum Via {
  /** Hay un recorte confirmado. El sistema lo puede aplicar sin preguntar. */
  PROGRAMA = 'PROGRAMA',
  /** Hay propuesta, pero sin confirmar: la mira un asesor y decide. */
  ASESOR = 'ASESOR',
  /** El archivo no tiene arreglo. Hay que volver a hacer la foto. */
  REPETIR = 'REPETIR',
  /** No hay nada que hacer: o esta bien, o no es una foto del inmueble. */
  NADA = 'NADA',
}

/** La propuesta completa de una foto, ya resuelta. */
export interface Encuadre {
  via: Via;
  cortes: Corte[];
  /** Por que la via es la que es, en una frase, cuando no es obvio. */
  motivo: string | null;
}

/*
  Aqui NO hay `girar` ni `verticales`, y no es un olvido.

  Se probaron los dos. Sobre 23 fotos reales —incluidas fachadas hechas con el
  movil desde la acera, que es el caso de manual— `girar` no se activo ni una
  sola vez, y `verticales` se activo una, en una foto de dron tomada desde
  ARRIBA, donde es imposible por definicion. Un campo que solo dispara cuando se
  equivoca no es una funcion a medias: es ruido con apariencia de dato, y el
  asesor que lo lea una vez y vea que miente deja de leer el bloque entero.

  Si algun dia se quiere enderezar, la via es medirlo en codigo —las lineas
  dominantes de una foto se detectan sin preguntarle a nadie— y no volver a
  pedirselo al modelo, que ya se le pregunto.
*/

/**
 * Cuanta franja plana tiene que medir el codigo para dar un corte por bueno.
 *
 * 15 y no menos porque por debajo de eso el recorte no cambia la foto y si
 * arriesga cortar algo; 15 y no mas porque a partir de ahi se pierden cortes
 * buenos y medidos (el canto de puerta de una alcoba media 16).
 */
const MINIMO_CONFIRMADO = 15;

/**
 * Y cuanto hay que poder recortar de verdad para que merezca la pena hacerlo.
 *
 * Es un umbral DISTINTO del de arriba, y mezclarlos rompia la funcion entera:
 * a 3:2 —el 95 % del inventario— lo que cabe quitar sin que la web vuelva a
 * recortar es un 14 %, asi que exigiendo 15 tambien aqui no habria salido
 * automatico ni un solo corte en todo el inventario. Una cosa es cuanta franja
 * muerta hay (15) y otra cuanta se puede quitar (5).
 *
 * Que un 14 % ya se nota esta comprobado mirandolo: en una sala 3:2 quita el
 * suelo vacio de abajo y no cuesta un solo pixel de ancho en la ficha.
 */
const MINIMO_APLICABLE = 5;

/**
 * Tope duro de lo que se recorta de un solo borde.
 *
 * Quitar mas de un tercio por un lado ya no es recortar, es encuadrar otra foto
 * — y eso no se hace sin que lo vea nadie.
 */
export const MAXIMO_CORTE = 35;

/**
 * La franja de proporciones en la que la web pinta las fotos.
 *
 * La ficha usa `object-cover`, asi que el recorte del servidor NO es el ultimo:
 * encima va el del navegador, que rellena la caja y tira lo que sobra. Una foto
 * que se sale de esta franja se recorta OTRA VEZ, y por un borde que nadie
 * eligio.
 *
 * Esta medido sobre una foto real: a un 3:2 se le quito el 35 % de abajo —un
 * recorte correcto, que mejoraba la foto vista suelta— y quedo en 2,29:1. Al
 * pintarla, el navegador se llevo el 24 % del ANCHO: desaparecieron la pared de
 * la izquierda y el final de la barra de la cocina. Se gano quitar suelo vacio
 * y se perdio media sala.
 */
const FICHA_MAS_ANCHA = 1.75;
const FICHA_MAS_ALTA = 1.29;

/**
 * Cuanto se puede recortar de un borde sin que la web vuelva a recortar.
 *
 * Dos casos, y los dos salen de mirar el resultado renderizado:
 *
 * - Una foto que YA cae dentro de la franja de la ficha (el 95 % del
 *   inventario es 3:2) se queda dentro: quitar alto la hace mas apaisada y
 *   quitar ancho la hace mas alta, y pasarse por cualquiera de los dos lados
 *   se paga con un segundo recorte que nadie decidio.
 *
 * - Una foto que ya esta FUERA —las verticales y las cuadradas— no entra en
 *   ese razonamiento, y comprobarlo cambio la regla: a un bano vertical de
 *   0,75 se le quito el canto de puerta de la derecha, la proporcion empeoro
 *   a 0,57 y aun asi lo que ve el visitante mejora, porque el navegador ya le
 *   estaba enseñando una banda horizontal del centro y la puerta se va de esa
 *   banda igual. Ahi manda el tope duro.
 */
function topeDelBorde(borde: Borde, aspecto: number): number {
  if (!Number.isFinite(aspecto) || aspecto <= 0) return MAXIMO_CORTE;
  // Fuera de la franja el argumento de la proporcion no aplica: ver arriba.
  if (aspecto < FICHA_MAS_ALTA) return MAXIMO_CORTE;

  const margen =
    borde === 'ARRIBA' || borde === 'ABAJO'
      ? 1 - aspecto / FICHA_MAS_ANCHA // quitar alto ensancha
      : 1 - FICHA_MAS_ALTA / aspecto; // quitar ancho estrecha

  return Math.max(0, Math.min(MAXIMO_CORTE, Math.floor(margen * 100)));
}

/** Lo que la puerta de codigo ya sabe de la foto y aqui manda. */
export interface EstadoFisico {
  /** Movida, oscura o quemada: la puerta lo midio y no se discute. */
  irrecuperable: boolean;
  /** Por debajo del minimo de ancho: recortar solo la haria mas pequeña. */
  pequena: boolean;
  /** No es una foto del inmueble: el logo, un plano, una captura. */
  noEsFoto: boolean;
  /**
   * Ancho partido por alto. Decide cuanto se puede recortar de cada borde sin
   * que el `object-cover` de la web vuelva a recortar por su cuenta.
   */
  aspecto: number;
}

/**
 * Cruza lo que ve el modelo con lo que mide el codigo, y decide.
 *
 * El reparto no es un capricho, esta medido sobre 23 fotos reales del
 * inventario:
 *
 * - QUE borde sobra y QUE hay en el, lo dice el modelo. El codigo no puede: lo
 *   liso no es lo inutil. El cielo de una terraza sale liso y es lo que se
 *   vende; el suelo de baldosa sale vivo por la junta y no aporta nada.
 *
 * - CUANTO sobra, lo dice el codigo. El modelo no puede: cuando la franja
 *   ocupaba el 40 % contestaba 10 o 15, siempre, y subir `detail` a `high`
 *   —seis veces mas caro— devolvia exactamente los mismos numeros.
 *
 * - SI TIENE ARREGLO, lo dice el codigo, porque ya lo midio. Una foto movida no
 *   se salva recortandola, y decirle a un asesor que "mejore el encuadre" de
 *   una foto irrecuperable es hacerle perder la tarde.
 *
 * Que un corte no se confirme NO significa que sea falso: significa que no se
 * aplica solo. Sobre las mismas 23 fotos, exigir la confirmacion descarto todos
 * los cortes que al aplicarlos estropeaban la foto —uno se comia la ventana de
 * una alcoba, otro mordia un espejo— a cambio de dejar en manos de una persona
 * unos dos tercios de las propuestas. Es el reparto que se quiere: lo que se
 * hace solo, se hace sobre seguro.
 */
export function resolverEncuadre(
  sugeridos: CorteSugerido[],
  franjas: DeadBands,
  estado: EstadoFisico,
): Encuadre {
  if (estado.noEsFoto) {
    return {
      via: Via.NADA,
      cortes: [],
      motivo: 'No es una foto del inmueble, no hay nada que retocar',
    };
  }

  // Lo fisico manda sobre lo estetico: en una foto movida o minuscula, el
  // encuadre es la ultima de sus preocupaciones y proponerlo despista.
  if (estado.irrecuperable || estado.pequena) {
    return {
      via: Via.REPETIR,
      cortes: [],
      motivo: estado.irrecuperable
        ? 'La foto esta movida o mal expuesta: eso no se arregla recortando, hay que repetirla'
        : 'La foto es mas pequeña de lo que pide la ficha: recortarla solo la haria mas pequeña',
    };
  }

  const vistos = new Set<Borde>();
  const cortes: Corte[] = [];
  for (const s of sugeridos) {
    // Un borde repetido es ruido: el segundo no describe nada nuevo.
    if (vistos.has(s.borde)) continue;
    vistos.add(s.borde);
    const medido = franjas[CLAVE[s.borde]] ?? 0;
    const tope = topeDelBorde(s.borde, estado.aspecto);
    /*
      Se confirma con lo MEDIDO y se aplica lo que cabe dentro del tope. Un
      borde cuyo tope es cero —una foto que ya esta en el limite de lo que la
      ficha admite— no puede ir a automatico por mucha franja muerta que tenga:
      recortarla la sacaria de la franja y la web se cobraria la diferencia.
    */
    cortes.push({
      ...s,
      medido,
      aplicable: Math.min(medido, tope),
      auto:
        medido >= MINIMO_CONFIRMADO &&
        Math.min(medido, tope) >= MINIMO_APLICABLE,
    });
  }

  if (!cortes.length) {
    return { via: Via.NADA, cortes, motivo: 'El encuadre esta bien como esta' };
  }
  // La via la marca si hay algo CONFIRMADO, no si hay algo propuesto: prometer
  // que el sistema lo hace solo y que luego no lo haga es peor que no prometer.
  return {
    via: cortes.some((c) => c.auto) ? Via.PROGRAMA : Via.ASESOR,
    cortes,
    motivo: null,
  };
}

/**
 * El recorte que se puede aplicar sin preguntar, en porcentaje por borde.
 *
 * UN SOLO BORDE, siempre: el confirmado mas grande. Y esto esta medido, no
 * elegido por prudencia. Aplicando a la vez los dos bordes confirmados de un
 * pasillo —26 % por la izquierda y 35 % por la derecha, cada uno correcto por
 * separado— la foto sale peor que la original: se le quita el 61 % del ancho y
 * el pasillo queda estrangulado en una tira. Cada corte era bueno; los dos
 * juntos, no.
 *
 * Los demas cortes no se tiran: siguen en `cortes`, para que una persona los
 * vea y decida. Lo que no se hace es encadenarlos sin que nadie mire.
 *
 * El numero es el del CODIGO y no el del modelo: es la unica de las dos cifras
 * que se ha medido. Devuelve null cuando no hay nada confirmado, que es el caso
 * mas frecuente.
 */
export function recorteAutomatico(encuadre: Encuadre): {
  arriba: number;
  abajo: number;
  izquierda: number;
  derecha: number;
} | null {
  const mejor = encuadre.cortes
    .filter((c) => c.auto)
    .reduce<Corte | null>((a, c) => (!a || c.medido > a.medido ? c : a), null);
  if (!mejor) return null;

  const p = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
  p[CLAVE[mejor.borde]] = mejor.aplicable;
  return p;
}
