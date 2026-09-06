import { z } from 'zod';

/**
 * La puerta de codigo: lo que se le exige a una foto ANTES de gastar un
 * centimo en el modelo.
 *
 * Todo lo de aqui se mide con sharp sobre los pixeles. No hay nada opinable:
 * o la foto tiene 1024 px de ancho o no los tiene. Lo que sí es opinable —si
 * la cocina se ve ordenada, si esa es la mejor portada— es trabajo del
 * analisis con IA, y ese cuesta dinero y solo lo dispara el equipo.
 *
 * Dos perfiles, y esta es la decision importante del modulo:
 *
 * - `INVENTORY` es lo que sube el equipo al inventario. Ahi el liston puede
 *   estar alto porque quien sube es un asesor con las fotos del fotografo, y
 *   una foto vertical de 500 px en la ficha es dinero perdido en cada visita.
 *
 * - `REQUEST` es lo que manda un propietario desde el movil para pedir que le
 *   consignen su casa. Ahi el liston ALTO CUESTA UN CLIENTE: el señor hace la
 *   foto con el telefono en vertical, le sale rechazada, y cierra el
 *   formulario. Asi que solo se bloquea lo que es literalmente inservible
 *   (rota, minuscula, formato ajeno) y todo lo demas es un aviso que ve el
 *   asesor cuando revisa la solicitud, no el propietario cuando la manda.
 *
 * Los numeros salen de medir las 6.306 imagenes que ya hay en produccion, no
 * de lo que suene razonable. Estan justificados uno a uno mas abajo.
 */

/** A quien se le aplica la puerta. */
export enum GateProfile {
  /** Subida del equipo al inventario: se exige calidad de anuncio. */
  INVENTORY = 'INVENTORY',
  /** Solicitud de consignacion desde la web: se exige que se pueda ver. */
  REQUEST = 'REQUEST',
}

/** Que hacer con un defecto. */
export enum GateSeverity {
  /** No entra. El mensaje explica que pasa y como arreglarlo. */
  BLOCK = 'BLOCK',
  /** Entra, pero el asesor ve el aviso y decide. */
  WARN = 'WARN',
}

/** Los defectos que sabe detectar el codigo. */
export enum GateCode {
  UNREADABLE = 'UNREADABLE',
  FORMAT = 'FORMAT',
  FILE_SIZE = 'FILE_SIZE',
  RESOLUTION = 'RESOLUTION',
  RESOLUTION_LOW = 'RESOLUTION_LOW',
  ORIENTATION = 'ORIENTATION',
  ASPECT = 'ASPECT',
  BLURRY = 'BLURRY',
  DARK = 'DARK',
  WASHED_OUT = 'WASHED_OUT',
  DUPLICATE = 'DUPLICATE',
  NEAR_DUPLICATE = 'NEAR_DUPLICATE',
}

/** Un defecto concreto encontrado en una foto. */
export interface GateIssue {
  code: GateCode;
  severity: GateSeverity;
  /**
   * Que pasa y como se arregla, en una frase y en español. Nunca un codigo:
   * quien lee esto es un asesor con veinte fotos que subir o un propietario
   * con el movil en la mano, y "ASPECT_RATIO_OUT_OF_RANGE" no le dice como
   * seguir adelante.
   */
  message: string;
  /** Lo medido y lo exigido, para pintarlo en el panel sin recalcular nada. */
  measured?: number;
  expected?: number;
}

/** Lo que sharp saca de la foto. Se guarda para no volver a decodificarla. */
export interface ImageMetrics {
  width: number;
  height: number;
  /** Ancho partido por alto. > 1 es horizontal. */
  aspectRatio: number;
  megapixels: number;
  bytes: number;
  /** `jpeg`, `png`, `webp`... tal cual lo ve sharp, no el Content-Type. */
  format: string;
  /**
   * Varianza del laplaciano sobre la imagen en gris reescalada a 512 px de
   * ancho. Mide cuanto contraste local hay: una foto enfocada tiene bordes y
   * la varianza sube; una movida los pierde y se desploma.
   *
   * El reescalado a 512 px NO es un detalle: sin el, la misma foto da un
   * numero distinto segun venga de 4032 px o de 1080, y el umbral no
   * significaria nada.
   */
  sharpness: number;
  /** Luminancia media, 0-255. */
  brightness: number;
  /** Fraccion de pixeles por debajo de 24: sombras aplastadas. */
  darkFraction: number;
  /** Fraccion de pixeles por encima de 246: blancos quemados. */
  brightFraction: number;
  /** dHash de 64 bits en hexadecimal. Sirve para detectar casi-iguales. */
  perceptualHash: string;
  /** SHA-256 del binario. Detecta la MISMA foto subida dos veces. */
  checksum: string;
}

/** El veredicto de la puerta para una foto. */
export interface GateResult {
  accepted: boolean;
  issues: GateIssue[];
  metrics: ImageMetrics;
}

// --- los umbrales -----------------------------------------------------------

/**
 * Los umbrales de un perfil. Todo numero, todo medible, todo editable desde el
 * panel: el dia que la agencia decida que 1024 px es poco, lo sube sin que
 * nadie recompile ni despliegue.
 */
export const gateRulesSchema = z.object({
  /** Ancho minimo en pixeles para que la foto entre. */
  minWidth: z.coerce.number().int().min(200).max(8000),
  /** Alto minimo en pixeles. */
  minHeight: z.coerce.number().int().min(200).max(8000),
  /**
   * Ancho por debajo del cual entra pero con aviso. Existe porque el sitio
   * sirve la ficha a 1600 px: una foto de 1080 se ve, pero estirada.
   */
  recommendedWidth: z.coerce.number().int().min(200).max(8000),
  /** Relacion de aspecto minima. Por encima de 1 obliga a horizontal. */
  minAspectRatio: z.coerce.number().min(0.3).max(4),
  /** Relacion de aspecto maxima: corta las panoramicas de tira. */
  maxAspectRatio: z.coerce.number().min(0.3).max(6),
  /** Si estar fuera del rango de aspecto bloquea o solo avisa. */
  aspectBlocks: z.boolean(),
  /** Peso maximo del fichero en megabytes. */
  maxFileMb: z.coerce.number().min(0.05).max(100),
  /** Por debajo de esta varianza del laplaciano se considera movida. */
  minSharpness: z.coerce.number().min(0).max(5000),
  /** Luminancia media minima; por debajo, oscura. */
  minBrightness: z.coerce.number().min(0).max(255),
  /** Luminancia media maxima; por encima, lavada. */
  maxBrightness: z.coerce.number().min(0).max(255),
  /** Fraccion maxima de negros aplastados. */
  maxDarkFraction: z.coerce.number().min(0).max(1),
  /** Fraccion maxima de blancos quemados. */
  maxBrightFraction: z.coerce.number().min(0).max(1),
  /**
   * Distancia de Hamming por debajo de la cual dos fotos se consideran la
   * misma escena. 0 es "el mismo encuadre exacto".
   */
  nearDuplicateDistance: z.coerce.number().int().min(0).max(20),
});

export type GateRules = z.infer<typeof gateRulesSchema>;

/**
 * Los umbrales del inventario, medidos contra las 6.306 fotos de produccion.
 *
 * `minWidth` 1024 / `minHeight` 683 y no 1280: 1024 deja fuera 225 fotos
 * (3,6 %) —que son las 121 marcas de agua de 500x500 y las verticales de
 * movil—, mientras que 1280 dejaria fuera 777 (12,3 %), y ahi dentro va la
 * tanda entera de 1080x720 que son fotos de casa perfectamente publicables. El
 * suelo tiene que estar donde la foto deja de servir, no donde deja de ser
 * ideal; para "no es ideal" esta `recommendedWidth`.
 *
 * `minAspectRatio` 1.20 es como se escribe "horizontal", que es lo que el
 * usuario repite. No 1.0 estricto porque una foto cuadrada tampoco vale para
 * una ficha que se pinta apaisada, y las 121 cuadradas del inventario son
 * justamente el placeholder de "sin imagen". Con 1,20 caen 219 fotos (3,5 %).
 *
 * `maxAspectRatio` 2.10 no rechaza hoy ni una sola foto: esta para el dia que
 * alguien suba una panoramica de movil de 4:1, que en la ficha sale como una
 * franja.
 *
 * `minSharpness` 80: la mediana del inventario es 568 y el percentil 5 es 144.
 * Con 80 se marcan 91 fotos (1,4 %) y son de verdad las movidas. Y AVISA, no
 * bloquea, porque la varianza del laplaciano se hunde tambien en fotos
 * legitimamente lisas —una pared blanca, un cielo, un banio de marmol— y
 * bloquear esas es rechazar fotos buenas sin que nadie sepa por que.
 *
 * `maxBrightFraction` 0,35 es lo que caza el placeholder blanco de "sin
 * imagen": 125 fotos identicas con el 94 % de la imagen en blanco puro.
 */
export const DEFAULT_INVENTORY_RULES: GateRules = {
  minWidth: 1024,
  minHeight: 683,
  recommendedWidth: 1600,
  minAspectRatio: 1.2,
  maxAspectRatio: 2.1,
  aspectBlocks: true,
  maxFileMb: 15,
  minSharpness: 80,
  minBrightness: 70,
  maxBrightness: 225,
  maxDarkFraction: 0.35,
  maxBrightFraction: 0.35,
  nearDuplicateDistance: 4,
};

/**
 * Los umbrales de la solicitud del propietario.
 *
 * Mismo codigo, otro liston. Aqui `aspectBlocks` es `false`: la foto vertical
 * del movil entra con un aviso. El propietario no esta publicando un anuncio,
 * esta pidiendo que le llamen; si la foto es vertical el asesor se la vuelve a
 * pedir cuando hablen, pero la solicitud ya esta dentro y el cliente tambien.
 *
 * 800x600 de suelo deja fuera 150 de las 6.306 (2,4 %): son las que no se ven.
 * Cualquier telefono de los ultimos quince anios pasa de largo.
 */
export const DEFAULT_REQUEST_RULES: GateRules = {
  minWidth: 800,
  minHeight: 600,
  recommendedWidth: 1600,
  minAspectRatio: 1.2,
  maxAspectRatio: 2.1,
  aspectBlocks: false,
  maxFileMb: 15,
  minSharpness: 60,
  minBrightness: 60,
  maxBrightness: 235,
  maxDarkFraction: 0.45,
  maxBrightFraction: 0.45,
  nearDuplicateDistance: 4,
};

export const DEFAULT_RULES: Record<GateProfile, GateRules> = {
  [GateProfile.INVENTORY]: DEFAULT_INVENTORY_RULES,
  [GateProfile.REQUEST]: DEFAULT_REQUEST_RULES,
};

/**
 * Los formatos que se aceptan.
 *
 * Es el mismo conjunto que ya admitia `StorageService`: no se estrecha aqui
 * porque quien decide que se puede decodificar es quien lo decodifica, y tener
 * dos listas distintas garantiza que un dia difieran.
 */
export const ACCEPTED_FORMATS = [
  'jpeg',
  'jpg',
  'png',
  'webp',
  'avif',
  'heif',
  'gif',
] as const;

// --- los mensajes -----------------------------------------------------------

/**
 * Los textos, aparte de las reglas.
 *
 * Cada uno dice que pasa y que hacer. "La foto mide 640x480 y hacen falta al
 * menos 1024x683" es accionable; "RESOLUTION_TOO_LOW" es un ticket de soporte.
 */
export const GATE_MESSAGES = {
  unreadable: (nombre: string) =>
    `No pudimos abrir "${nombre}". Puede que el archivo se cortara al subirlo: vuelve a exportarlo desde el movil o el ordenador e intentalo otra vez.`,

  format: (nombre: string, formato: string) =>
    `"${nombre}" viene en formato ${formato || 'desconocido'}, que no sabemos procesar. Guardala como JPG o PNG y subela de nuevo.`,

  fileSize: (nombre: string, mb: number, max: number) =>
    `"${nombre}" pesa ${mb.toFixed(1)} MB y el limite son ${max} MB. Al exportarla desde el movil elige "tamano mediano", o abrela y guardala como JPG con calidad alta.`,

  resolution: (ancho: number, alto: number, minA: number, minH: number) =>
    `La foto mide ${ancho}x${alto} pixeles y se necesitan al menos ${minA}x${minH}. Sube la foto original de la camara o del movil, no la que llega por WhatsApp: WhatsApp la reduce y se pierde el detalle.`,

  resolutionLow: (ancho: number, recomendado: number) =>
    `La foto mide ${ancho} px de ancho y la ficha se muestra a ${recomendado} px, asi que se vera algo blanda. Entra igual, pero si tienes el original a mayor tamano, mejor ese.`,

  orientation: (ancho: number, alto: number) =>
    `La foto es vertical (${ancho}x${alto}) y la ficha del inmueble se ve apaisada: saldria con dos franjas a los lados. Repitela girando el movil de lado, o recortala en horizontal.`,

  orientationWarn: (ancho: number, alto: number) =>
    `La foto es vertical (${ancho}x${alto}). La aceptamos, pero en la web se vera mejor si la repites con el movil de lado.`,

  aspect: (ratio: number, min: number, max: number) =>
    `La proporcion de la foto (${ratio.toFixed(2)}:1) se sale de lo que admite la ficha (entre ${min}:1 y ${max}:1). Recortala a un formato normal, tipo 3:2 o 16:9.`,

  blurry: () =>
    `La foto se ve movida o desenfocada. Si puedes, repitela apoyando el movil en algo firme y tocando la pantalla sobre el punto que quieras enfocar antes de disparar.`,

  dark: () =>
    `La foto ha salido muy oscura. Enciende las luces de la estancia, abre las cortinas y repitela: una habitacion a oscuras parece mas pequena de lo que es.`,

  washedOut: () =>
    `La foto ha salido lavada o con la ventana quemada de blanco. Prueba a hacerla con la luz de fuera a tu espalda, o toca la parte clara de la pantalla antes de disparar para que el movil baje la exposicion.`,

  /*
    `que` es como se llama la galeria en la que se esta subiendo: "este
    inmueble", "este proyecto", "esta tipologia". Lo trae `Coleccion.que`, que
    ya lo sabe. Sin esto, subir el plano repetido de una tipologia contestaba
    "ya esta subida en este inmueble" y quien lo lee cree que se equivoco de
    pantalla.
  */
  duplicate: (que: string) =>
    `Esta foto ya esta subida en ${que}, identica. Se descarta para no repetirla en la ficha.`,

  nearDuplicate: (que: string) =>
    `Esta foto es casi igual que otra que ya esta subida en ${que}. Entra, pero si son la misma escena conviene dejar solo la mejor: una galeria con la misma sala cuatro veces cansa al que la mira.`,
} as const;
