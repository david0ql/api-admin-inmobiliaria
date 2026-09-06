import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppConfigService } from '../../shared/config/app-config.service';
import {
  ACCEPTED_FORMATS,
  GATE_MESSAGES,
  GateCode,
  GateProfile,
  GateSeverity,
  type GateIssue,
  type GateResult,
  type GateRules,
  type ImageMetrics,
} from './image-gate.rules';
import { GateSettingsService } from './gate-settings.service';

/**
 * Tope de pixeles de entrada, igual que en `StorageService`: un PNG de 2 KB que
 * declare 50.000x50.000 tumba el proceso al decodificarlo, y aqui se decodifica
 * ANTES que alli.
 */
const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Ancho al que se normaliza todo antes de medir nitidez y exposicion.
 *
 * Sin esto los umbrales no significan nada: la varianza del laplaciano de una
 * misma foto cambia por un factor de cuatro entre verla a 4032 px y verla a
 * 1080. Midiendo siempre a 512 px en gris, el numero es comparable entre una
 * foto de camara y una de movil, y por eso se puede poner un umbral.
 */
const ANCHO_ANALISIS = 512;

/** Rejilla del dHash: 9x8 pixeles dan los 64 bits de la huella. */
const HASH_W = 9;
const HASH_H = 8;

/** Lo que hay que saber de las fotos que ya estan para detectar repetidas. */
export interface HuellaPrevia {
  checksum: string | null;
  perceptualHash: string | null;
}

/**
 * La puerta de codigo.
 *
 * Todo lo que se puede decidir mirando los pixeles se decide aqui, gratis y
 * en milisegundos, antes de que nadie piense en llamar a un modelo. Es a
 * proposito la primera capa: el analisis con IA cuesta dinero por imagen, y
 * gastarlo en una foto de 500x500 que no iba a publicarse es tirarlo.
 *
 * Decodifica una vez y de esa unica pasada saca todo: medidas, nitidez,
 * exposicion y huella. Lo caro de una imagen es abrirla.
 */
@Injectable()
export class ImageGateService {
  private readonly logger = new Logger(ImageGateService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly settings: GateSettingsService,
  ) {}

  /**
   * Pasa una foto por la puerta.
   *
   * `previas` son las huellas de las fotos que ya tiene ese inmueble o esa
   * solicitud; sirven para no repetir la misma imagen dos veces en la galeria.
   * Va como parametro y no se consulta aqui porque quien sabe que fotos hay ya
   * es quien las esta guardando, y asi este servicio no toca la base.
   */
  async evaluate(
    buffer: Buffer,
    originalName: string,
    profile: GateProfile,
    previas: HuellaPrevia[] = [],
    /**
     * Como se llama la galeria en los mensajes: "este inmueble", "este
     * proyecto", "esta tipologia". Lo sabe quien esta guardando, no esto.
     */
    que = 'este inmueble',
  ): Promise<GateResult> {
    const rules = await this.settings.rules(profile);
    const nombre = originalName || 'imagen';

    let metrics: ImageMetrics;
    try {
      metrics = await this.measure(buffer);
    } catch (error) {
      this.logger.debug(
        `No se pudo medir "${nombre}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        accepted: false,
        issues: [
          {
            code: GateCode.UNREADABLE,
            severity: GateSeverity.BLOCK,
            message: GATE_MESSAGES.unreadable(nombre),
          },
        ],
        // Sin poder decodificarla lo unico cierto es cuanto ocupa.
        metrics: vacio(buffer),
      };
    }

    const issues = this.check(metrics, nombre, rules, profile, previas, que);
    return {
      accepted: !issues.some((i) => i.severity === GateSeverity.BLOCK),
      issues,
      metrics,
    };
  }

  /**
   * Mide una imagen. Publico porque el analisis con IA le pasa estas mismas
   * cifras al modelo: no tiene sentido pedirle a un modelo de pago que opine
   * sobre si una foto esta enfocada cuando ya lo sabemos con certeza.
   */
  async measure(buffer: Buffer): Promise<ImageMetrics> {
    const opciones = { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 } as const;

    const meta = await sharp(buffer, opciones).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) throw new Error('sin dimensiones');

    // Gris y reducida: es lo unico que hace falta para nitidez y exposicion, y
    // en 512 px cabe en cache de CPU.
    const { data, info } = await sharp(buffer, opciones)
      .greyscale()
      .resize({
        width: ANCHO_ANALISIS,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let suma = 0;
    let oscuros = 0;
    let claros = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      suma += v;
      if (v < 24) oscuros++;
      if (v > 246) claros++;
    }

    const mini = await sharp(buffer, opciones)
      .greyscale()
      .resize(HASH_W, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();

    return {
      width,
      height,
      aspectRatio: width / height,
      megapixels: (width * height) / 1_000_000,
      bytes: buffer.length,
      format: String(meta.format ?? ''),
      sharpness: redondear(varianzaLaplaciano(data, info.width, info.height)),
      brightness: redondear(suma / data.length),
      darkFraction: redondear(oscuros / data.length, 4),
      brightFraction: redondear(claros / data.length, 4),
      perceptualHash: dHash(mini),
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  // --- las reglas, una a una ------------------------------------------------

  private check(
    m: ImageMetrics,
    nombre: string,
    rules: GateRules,
    profile: GateProfile,
    previas: HuellaPrevia[],
    que: string,
  ): GateIssue[] {
    const issues: GateIssue[] = [];
    const bloquea = (
      code: GateCode,
      message: string,
      measured?: number,
      expected?: number,
    ) =>
      issues.push({
        code,
        severity: GateSeverity.BLOCK,
        message,
        measured,
        expected,
      });
    const avisa = (
      code: GateCode,
      message: string,
      measured?: number,
      expected?: number,
    ) =>
      issues.push({
        code,
        severity: GateSeverity.WARN,
        message,
        measured,
        expected,
      });

    // Formato. Bloquea siempre: si no lo sabemos decodificar, lo demas sobra.
    const formato = m.format.toLowerCase();
    if (
      !ACCEPTED_FORMATS.includes(formato as (typeof ACCEPTED_FORMATS)[number])
    ) {
      bloquea(GateCode.FORMAT, GATE_MESSAGES.format(nombre, m.format));
      return issues;
    }

    // Peso. Bloquea porque por encima del limite el fichero ni llega: multer lo
    // corta antes. Se comprueba igual para dar el mensaje bueno cuando el
    // buffer viene de otro sitio (una importacion, una URL).
    const maxBytes = Math.min(
      rules.maxFileMb * 1024 * 1024,
      this.config.uploadMaxBytes,
    );
    if (m.bytes > maxBytes) {
      bloquea(
        GateCode.FILE_SIZE,
        GATE_MESSAGES.fileSize(
          nombre,
          m.bytes / 1024 / 1024,
          Math.round(maxBytes / 1024 / 1024),
        ),
        m.bytes,
        maxBytes,
      );
    }

    // Resolucion. Bloquea en los dos perfiles: por debajo del suelo la foto no
    // se ve, y eso no lo arregla ningun aviso.
    if (m.width < rules.minWidth || m.height < rules.minHeight) {
      bloquea(
        GateCode.RESOLUTION,
        GATE_MESSAGES.resolution(
          m.width,
          m.height,
          rules.minWidth,
          rules.minHeight,
        ),
        m.width,
        rules.minWidth,
      );
    } else if (m.width < rules.recommendedWidth) {
      // Entre el suelo y lo recomendado: entra, pero se dice. La ficha se pinta
      // a 1600 px y una foto de 1080 se estira; es informacion util, no un
      // motivo para rechazar una foto de casa perfectamente valida.
      avisa(
        GateCode.RESOLUTION_LOW,
        GATE_MESSAGES.resolutionLow(m.width, rules.recommendedWidth),
        m.width,
        rules.recommendedWidth,
      );
    }

    // Orientacion y proporcion. Es el requisito que el usuario repite: las
    // fotos siempre horizontales.
    //
    // Se separa "vertical" de "proporcion rara" porque no se arreglan igual:
    // una vertical se repite girando el movil, y una panoramica de 4:1 se
    // recorta. Un solo mensaje para las dos cosas no le sirve a nadie.
    if (m.aspectRatio < rules.minAspectRatio) {
      if (rules.aspectBlocks) {
        bloquea(
          GateCode.ORIENTATION,
          GATE_MESSAGES.orientation(m.width, m.height),
          redondear(m.aspectRatio),
          rules.minAspectRatio,
        );
      } else {
        avisa(
          GateCode.ORIENTATION,
          GATE_MESSAGES.orientationWarn(m.width, m.height),
          redondear(m.aspectRatio),
          rules.minAspectRatio,
        );
      }
    } else if (m.aspectRatio > rules.maxAspectRatio) {
      const mensaje = GATE_MESSAGES.aspect(
        m.aspectRatio,
        rules.minAspectRatio,
        rules.maxAspectRatio,
      );
      if (rules.aspectBlocks) {
        bloquea(
          GateCode.ASPECT,
          mensaje,
          redondear(m.aspectRatio),
          rules.maxAspectRatio,
        );
      } else {
        avisa(
          GateCode.ASPECT,
          mensaje,
          redondear(m.aspectRatio),
          rules.maxAspectRatio,
        );
      }
    }

    /*
      Nitidez y exposicion SIEMPRE avisan, nunca bloquean, en los dos perfiles.

      No es indulgencia: es que la medida tiene falsos positivos que no se
      pueden distinguir desde el codigo. La varianza del laplaciano se hunde
      igual en una foto movida que en una pared lisa, en un banio de marmol
      blanco o en una terraza contra el cielo, y la luminancia media se dispara
      en una fachada al mediodia igual que en una foto quemada. Bloquear con
      eso seria rechazar fotos buenas dando una razon que el asesor sabe que es
      falsa, y a la tercera vez deja de leer los mensajes.

      Avisando, la decision la toma quien esta viendo la foto. Y quien la ve de
      verdad es el analisis con IA, que para eso sirve.
    */
    const oscura =
      m.brightness < rules.minBrightness ||
      m.darkFraction > rules.maxDarkFraction;

    /*
      Lo oscuro explica lo borroso, asi que no se dicen las dos cosas.

      Una foto a oscuras pierde contraste local por definicion, y con el
      contraste se hunde la varianza del laplaciano: al medirla sale "movida"
      aunque el enfoque sea perfecto. Decirle al asesor "esta oscura Y esta
      movida" es darle dos tareas cuando solo hay una, y ademas la segunda es
      falsa: va a repetir la foto apoyando el movil y le va a salir igual de
      oscura. Se avisa de la causa y se calla el sintoma.
    */
    if (m.sharpness < rules.minSharpness && !oscura) {
      avisa(
        GateCode.BLURRY,
        GATE_MESSAGES.blurry(),
        m.sharpness,
        rules.minSharpness,
      );
    }
    if (oscura) {
      avisa(
        GateCode.DARK,
        GATE_MESSAGES.dark(),
        m.brightness,
        rules.minBrightness,
      );
    }
    if (
      m.brightness > rules.maxBrightness ||
      m.brightFraction > rules.maxBrightFraction
    ) {
      avisa(
        GateCode.WASHED_OUT,
        GATE_MESSAGES.washedOut(),
        m.brightness,
        rules.maxBrightness,
      );
    }

    // Repetidas.
    //
    // Bit a bit bloquea: es literalmente el mismo fichero subido dos veces y
    // guardarlo otra vez es un duplicado en la ficha y espacio tirado. En el
    // inventario de hoy hay 530 imagenes en esa situacion.
    //
    // "Casi igual" solo avisa: dos disparos consecutivos de la misma sala
    // pueden ser dos fotos legitimas —una con la puerta abierta, otra con luz
    // distinta— y esa la elige una persona, no un umbral de Hamming.
    if (previas.some((p) => p.checksum && p.checksum === m.checksum)) {
      bloquea(GateCode.DUPLICATE, GATE_MESSAGES.duplicate(que));
    } else if (m.perceptualHash) {
      // La distancia se guarda, no solo se compara: el panel puede enseñar
      // "difiere en 2 bits de 64" y quien mira las dos fotos entiende de que se
      // le habla. Un aviso sin cifra no se puede ni discutir ni ajustar.
      const masParecida = previas.reduce<number | null>((mejor, p) => {
        if (!p.perceptualHash) return mejor;
        const d = distanciaHamming(p.perceptualHash, m.perceptualHash);
        return mejor === null || d < mejor ? d : mejor;
      }, null);
      if (masParecida !== null && masParecida <= rules.nearDuplicateDistance) {
        avisa(
          GateCode.NEAR_DUPLICATE,
          GATE_MESSAGES.nearDuplicate(que),
          masParecida,
          rules.nearDuplicateDistance,
        );
      }
    }

    // El perfil no cambia que se comprueba, solo con que liston. Se deja en el
    // log de depuracion para poder explicar un rechazo cuando alguien pregunte.
    this.logger.debug(
      `${nombre} [${profile}] ${m.width}x${m.height} nitidez=${m.sharpness} -> ${issues.map((i) => i.code).join(',') || 'limpia'}`,
    );

    return issues;
  }
}

// --- calculo ----------------------------------------------------------------

/**
 * Varianza del laplaciano 4-vecinos.
 *
 * El laplaciano responde a los cambios bruscos de luminancia, o sea a los
 * bordes. Una foto enfocada tiene muchos y su varianza es alta; una movida los
 * ha convertido en degradados y la varianza cae. Es el metodo estandar y, sobre
 * todo, es explicable: se puede enseñar el numero al lado de la foto.
 *
 * Se recorre sin los bordes de la imagen para no tener que inventar pixeles
 * fuera del marco.
 */
function varianzaLaplaciano(datos: Buffer, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        4 * datos[i] -
        datos[i - 1] -
        datos[i + 1] -
        datos[i - w] -
        datos[i + w];
      suma += v;
      suma2 += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const media = suma / n;
  return Math.max(0, suma2 / n - media * media);
}

/**
 * dHash: 64 bits que describen la ESCENA, no los bytes.
 *
 * Cada bit dice si un pixel de una rejilla de 9x8 es mas claro que el de su
 * derecha. Eso sobrevive a recomprimir, a redimensionar y a un retoque suave —
 * que es justo donde el checksum falla— y cambia en cuanto cambia el encuadre.
 */
function dHash(mini: Buffer): string {
  let hex = '';
  for (let y = 0; y < HASH_H; y++) {
    let nibble = 0;
    let bits = 0;
    for (let x = 0; x < HASH_W - 1; x++) {
      const i = y * HASH_W + x;
      nibble = (nibble << 1) | (mini[i] > mini[i + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Cuantos bits difieren entre dos huellas. */
export function distanciaHamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

function redondear(v: number, decimales = 2): number {
  const f = 10 ** decimales;
  return Math.round(v * f) / f;
}

/** Metricas de una imagen que no se pudo abrir: solo se sabe lo que ocupa. */
function vacio(buffer: Buffer): ImageMetrics {
  return {
    width: 0,
    height: 0,
    aspectRatio: 0,
    megapixels: 0,
    bytes: buffer.length,
    format: '',
    sharpness: 0,
    brightness: 0,
    darkFraction: 0,
    brightFraction: 0,
    perceptualHash: '',
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}
