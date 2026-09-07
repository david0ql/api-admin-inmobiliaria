import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ImageAnalysis } from './domain/image-analysis.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { StorageService, type Caja } from '../media/storage.service';
import { ImageAnalysisService } from './image-analysis.service';
import {
  BORDES,
  MAXIMO_CORTE,
  Via,
  type Borde,
  type Corte,
  type Encuadre,
} from './framing';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * La propuesta de cada foto, en la forma que pinta el panel.
 *
 * Existe porque la pantalla parte el trabajo en DOS bloques con destinatarios
 * distintos —lo que dispara un boton y lo que obliga a alguien a coger el coche
 * e ir a la casa— y ese reparto tiene que decidirse aqui, en el servidor.
 *
 * Que lo decida el servidor y no el panel no es una preferencia de estilo. Si
 * la pantalla lo dedujera del `codigo` con un diccionario propio, el dia que se
 * añada un codigo nuevo caeria en el cubo equivocado SIN dar ningun error, y el
 * cubo equivocado en esta pantalla significa prometerle a un asesor que un
 * boton arregla algo que solo se arregla volviendo con la camara. Un fallo que
 * no se ve es peor que uno que revienta.
 *
 * Aqui no se llama al modelo ni se paga nada: se lee lo ya guardado por el
 * analisis y se traduce. Quien paga es `analyzeProperty`.
 */

/** A quien le toca. Lo unico por lo que la pantalla se parte en dos. */
export type Destino = 'AUTO' | 'REVISITA';

/** Cuanto se nota. La pantalla lo pinta como "Se nota" / "Mejorable" / "Detalle". */
export type Severidad = 'ALTA' | 'MEDIA' | 'BAJA';

export interface Sugerencia {
  /**
   * Estable entre llamadas: se compone del id del analisis y de lo que
   * describe. La pantalla lo usa como clave de lista y para recordar lo que
   * alguien ya descarto, asi que un id nuevo en cada peticion haria que la
   * lista parpadeara y que un descarte no sobreviviera a recargar.
   */
  id: string;
  destino: Destino;
  /** Solo elige el icono. Uno desconocido pinta el generico y no rompe nada. */
  codigo: string;
  /** Una linea en español. Es lo que se lee. */
  titulo: string;
  /** La explicacion, en español. */
  detalle: string | null;
  severidad: Severidad;
}

/** Lo medido de la foto, para enseñar el dato al lado de la frase. */
export interface MetricasFoto {
  anchura: number;
  altura: number;
  aspecto: number;
  nitidez: number | null;
  brillo: number | null;
}

export interface PropuestaImagen {
  propertyImageId: string;
  metricas: MetricasFoto | null;
  sugerencias: Sugerencia[];
}

/** Como se llama cada borde cuando se lo lee una persona. */
const BORDE_TEXTO: Record<Corte['borde'], string> = {
  ARRIBA: 'por arriba',
  ABAJO: 'por abajo',
  IZQUIERDA: 'por la izquierda',
  DERECHA: 'por la derecha',
};

/**
 * Que icono le toca a un recorte, por lo que el modelo dijo que hay en el borde.
 *
 * Es una aproximacion por palabras y puede fallar, y da igual: `codigo` solo
 * elige el icono. Un fallo aqui pinta un icono generico, no una frase falsa.
 */
function codigoDeCorte(corte: Corte): string {
  const que = corte.que.toLowerCase();
  if (que.includes('suelo') || que.includes('baldosa') || que.includes('piso'))
    return 'SUELO';
  if (que.includes('techo')) return 'TECHO';
  if (que.includes('pared') || que.includes('muro')) return 'PARED';
  return 'RECORTE';
}

/**
 * Y a una tarea del asesor. Mismo criterio: si no se reconoce, generico.
 *
 * No se intenta afinar mas porque `fixes` es texto libre del modelo y cualquier
 * clasificacion fina seria adivinar. Lo que NO se hace nunca es que de este
 * diccionario dependa el `destino`: eso se decide arriba y por construccion.
 */
function codigoDeTarea(texto: string): string {
  const t = texto.toLowerCase();
  if (t.includes('cortina') || t.includes('luz') || t.includes('ilumina'))
    return 'LUZ';
  if (
    t.includes('orden') ||
    t.includes('despeja') ||
    t.includes('quitar') ||
    t.includes('retirar') ||
    t.includes('limpia')
  )
    return 'DESORDEN';
  if (t.includes('repet') || t.includes('repite')) return 'MOVIDA';
  return 'REVISITA';
}

@Injectable()
export class PropuestaService {
  /*
    Solo depende del servicio de analisis, no del repositorio.

    Podria leer `image_analysis` por su cuenta y se ahorraria un salto, pero
    entonces tendria su propia idea de quien puede ver que — y `findForProperty`
    ya comprueba la sede y la propiedad del inmueble. Un modulo que se inventa
    sus reglas de visibilidad es un agujero que nadie sabe que existe.
  */
  private readonly logger = new Logger(PropuestaService.name);

  constructor(
    private readonly analysis: ImageAnalysisService,
    @InjectRepository(PropertyImage)
    private readonly images: Repository<PropertyImage>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Lo ya propuesto de un inmueble. No cuesta nada: solo lee.
   *
   * Se queda con el analisis MAS RECIENTE de cada foto. Una foto puede tener
   * varias filas —una por version del prompt y modelo, que es como se comparan
   * dos versiones— y la pantalla tiene que enseñar una, la de ahora.
   */
  async porInmueble(
    propertyId: string,
    actor: AuthenticatedActor,
  ): Promise<{ images: PropuestaImagen[]; generatedAt: string | null }> {
    const guardado = await this.analysis.findForProperty(propertyId, actor);

    const ultimo = new Map<string, ImageAnalysis>();
    for (const a of guardado.images) {
      // `findForProperty` ya devuelve ordenado por fecha descendente, asi que
      // el primero que se ve de cada foto es el bueno.
      if (!ultimo.has(a.propertyImageId)) ultimo.set(a.propertyImageId, a);
    }

    const images = [...ultimo.values()].map((a) => this.deAnalisis(a));
    const generatedAt =
      [...ultimo.values()]
        .reduce<Date | null>(
          (mayor, a) => (!mayor || a.createdAt > mayor ? a.createdAt : mayor),
          null,
        )
        ?.toISOString() ?? null;

    return { images, generatedAt };
  }

  /**
   * Analizar y devolver la propuesta. ESTO SI CUESTA DINERO.
   *
   * Se apoya en `analyzeProperty` en lugar de repetir su logica: ahi estan el
   * troceado en tandas, el reintento de lo que el modelo se deja y el control de
   * gasto. Una segunda forma de lanzar el analisis seria una segunda forma de
   * saltarse esos tres.
   */
  async analizar(
    propertyId: string,
    actor: AuthenticatedActor,
    opciones: { imageIds?: string[]; force?: boolean } = {},
  ): Promise<{ images: PropuestaImagen[]; generatedAt: string | null }> {
    await this.analysis.analyzeProperty(propertyId, actor, opciones);
    return this.porInmueble(propertyId, actor);
  }

  // --- la traduccion --------------------------------------------------------

  private deAnalisis(a: ImageAnalysis): PropuestaImagen {
    return {
      propertyImageId: a.propertyImageId,
      metricas: this.metricas(a),
      sugerencias: [...this.deEncuadre(a), ...this.deTareas(a)],
    };
  }

  private metricas(a: ImageAnalysis): MetricasFoto | null {
    const m = a.metrics;
    if (!m) return null;
    const anchura = Number(m.width) || 0;
    const altura = Number(m.height) || 0;
    if (!anchura || !altura) return null;
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      anchura,
      altura,
      aspecto: num(m.aspectRatio) ?? Math.round((anchura / altura) * 100) / 100,
      nitidez: num(m.sharpness),
      brillo: num(m.brightness),
    };
  }

  /**
   * Lo que sale del encuadre.
   *
   * `destino` se decide por `auto`, que es lo que ha confirmado el codigo
   * midiendo los pixeles — no por lo que opine el modelo. Un corte sin
   * confirmar sigue siendo una propuesta util, pero no la ejecuta un boton:
   * medido sobre fotos reales, aplicar sin confirmar se comio la ventana de una
   * alcoba y mordio un espejo.
   */
  private deEncuadre(a: ImageAnalysis): Sugerencia[] {
    const e: Encuadre | null = a.framing;
    if (!e) return [];

    if (e.via === Via.REPETIR) {
      return [
        {
          id: `${a.id}:repetir`,
          destino: 'REVISITA',
          codigo: 'MOVIDA',
          titulo: 'Hay que repetir esta foto',
          detalle: e.motivo,
          // Alta siempre: una foto que no se puede publicar no es un detalle.
          severidad: 'ALTA',
        },
      ];
    }

    return e.cortes.map((c) => {
      /*
        El numero que se enseña es el del CODIGO cuando lo hay, y el del modelo
        solo cuando no se confirmo. Es la unica de las dos cifras que se ha
        medido: el modelo subestima siempre, y decirle a un asesor "recorta un
        10 %" cuando sobra el 35 % es darle una instruccion que no arregla nada.

        Y va acotado al mismo tope que aplica `recorteAutomatico`. Sin acotarlo,
        una franja medida del 45 % se anunciaba como "recortar un 45 %" y el
        boton recortaba un 35: el titulo prometia una cosa y el sistema hacia
        otra, que es justo lo que hace que se deje de creer a la pantalla.
      */
      const cuanto = c.auto ? Math.min(MAXIMO_CORTE, c.medido) : c.porcion;
      return {
        id: `${a.id}:recorte:${c.borde}`,
        destino: c.auto ? ('AUTO' as const) : ('REVISITA' as const),
        codigo: codigoDeCorte(c),
        titulo: c.auto
          ? `Recortar un ${cuanto} % ${BORDE_TEXTO[c.borde]}: ${c.que}`
          : `Quiza sobre algo ${BORDE_TEXTO[c.borde]}: ${c.que}`,
        detalle: c.auto
          ? `El modelo señalo este borde y el codigo confirma que ahi hay una franja muerta del ${c.medido} % (el modelo estimaba ${c.porcion} %). Se recorta hasta el ${cuanto} %, que es el tope de un solo borde. Se puede aplicar sin mirar.`
          : `El modelo señalo este borde, pero el codigo mide solo un ${c.medido} % de franja muerta ahi. Conviene mirar la foto antes de recortar: puede que lo que hay en ese borde sea algo que se vende.`,
        severidad:
          c.auto && cuanto >= 25 ? ('MEDIA' as const) : ('BAJA' as const),
      };
    });
  }

  /**
   * Lo que solo se arregla volviendo a la casa: ordenar, abrir cortinas, mover
   * el carro, repetir la toma desde otro sitio.
   *
   * Sale de `fixes`, que es texto libre del modelo, y va SIEMPRE a `REVISITA`.
   * Nunca puede llegar a `AUTO` por mucho que cambie el prompt: ninguna frase
   * de esta lista describe algo que se haga tocando el archivo.
   */
  private deTareas(a: ImageAnalysis): Sugerencia[] {
    return a.fixes.map((texto, i) => ({
      id: `${a.id}:tarea:${i}`,
      destino: 'REVISITA' as const,
      codigo: codigoDeTarea(texto),
      titulo: texto,
      detalle: null,
      // Si la foto no se puede publicar tal cual, lo que haga falta para
      // arreglarla no es un detalle.
      severidad: a.usable ? ('MEDIA' as const) : ('ALTA' as const),
    }));
  }

  // --- aplicar el recorte ---------------------------------------------------

  /**
   * Recorta una foto con los cortes que ha aceptado una persona.
   *
   * Los cortes vienen EN EL CUERPO y no se recalculan aqui a partir de la
   * propuesta guardada, y eso es deliberado: quien mira la pantalla puede
   * aceptar unos y otros no, asi que lo que se aplica no tiene por que ser lo
   * que se propuso. Recalcularlo aqui seria ignorar lo que la persona decidio.
   *
   * Una lista vacia deshace el recorte y devuelve la foto entera. No es un caso
   * raro: es el boton de deshacer.
   */
  async recortar(
    imageId: string,
    cortes: { borde: Borde; porcion: number }[],
    actor: AuthenticatedActor,
  ): Promise<PropertyImage> {
    const image = await this.images.findOne({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Imagen no encontrada');

    // Las mismas comprobaciones de sede y propiedad que para analizar: quien no
    // puede tocar el inmueble tampoco recorta sus fotos.
    await this.analysis.assertPuedeTocar(image.propertyId, actor);

    const caja = cajaDeCortes(cortes);
    const { bytes, width, height } = await this.storage.recortar(
      image.storageKey,
      caja,
      image.develop,
    );

    /*
      El tamaño se actualiza con el recorte, no solo el peso.

      Recortar cambia lo que mide el fichero, y la fila es de donde salen las
      medidas que el panel enseña al lado de la propuesta. Sin esto, una foto
      recortada seguiria anunciando su tamaño de antes: el asesor leeria
      "2528x1696, 1,49:1" mirando una foto que ya es 2528x1459 y 1,73:1.
    */
    await this.images.update(
      { id: imageId },
      { crop: caja, bytes, width, height },
    );
    this.logger.log(
      caja
        ? `${actor.id} recorta ${imageId}: ${JSON.stringify(caja)}`
        : `${actor.id} deshace el recorte de ${imageId}`,
    );
    return (await this.images.findOne({ where: { id: imageId } }))!;
  }
}

/**
 * Traduce los cortes por borde a la caja en fracciones que entiende el
 * almacenamiento.
 *
 * Acota cada borde al tope duro y comprueba que quede foto: dos cortes
 * opuestos del 35 % dejan un 30 % del ancho, y eso ya no es un recorte. El tope
 * de proporcion que se aplica al proponer NO se repite aqui a proposito — quien
 * llama es una persona que esta viendo la previsualizacion, y el sistema no
 * tiene por que discutirle un encuadre que esta mirando. Lo que si se impide es
 * destruir la foto por un dedo en el teclado.
 */
export function cajaDeCortes(
  cortes: { borde: Borde; porcion: number }[],
): Caja | null {
  const p: Record<Borde, number> = {
    ARRIBA: 0,
    ABAJO: 0,
    IZQUIERDA: 0,
    DERECHA: 0,
  };
  for (const c of cortes) {
    if (!(BORDES as readonly string[]).includes(c.borde)) continue;
    const n = Number(c.porcion);
    if (!Number.isFinite(n) || n <= 0) continue;
    // El mayor gana si el borde viene repetido, en vez de sumarlos: sumar dos
    // entradas del mismo borde es como se recorta media foto sin querer.
    p[c.borde] = Math.max(p[c.borde], Math.min(MAXIMO_CORTE, n));
  }

  const ancho = 1 - (p.IZQUIERDA + p.DERECHA) / 100;
  const alto = 1 - (p.ARRIBA + p.ABAJO) / 100;
  if (ancho >= 1 && alto >= 1) return null;
  if (ancho < 0.4 || alto < 0.4) {
    throw new BadRequestException(
      'Ese recorte se lleva mas de la mitad de la foto por un lado. Si hace falta quitar tanto, la foto hay que repetirla, no recortarla.',
    );
  }

  return {
    x: p.IZQUIERDA / 100,
    y: p.ARRIBA / 100,
    ancho,
    alto,
  };
}
