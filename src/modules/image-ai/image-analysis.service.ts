import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfigService } from '../../shared/config/app-config.service';
import { StorageService } from '../media/storage.service';
import { ImageGateService } from '../media/image-gate.service';
import { GateProfile } from '../media/image-gate.rules';
import type { GateRules, ImageMetrics } from '../media/image-gate.rules';
import { GateSettingsService } from '../media/gate-settings.service';
import { resolverEncuadre } from './framing';
import type { Encuadre, EstadoFisico } from './framing';
import { OpenAiProvider } from '../assistant/openai-provider';
import type { VisionImage } from '../assistant/vision-provider';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { assertCanMutate, assertSameBranch } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ImageAnalysis } from './domain/image-analysis.entity';
import { ImageAlbumAnalysis } from './domain/image-album-analysis.entity';
import { huellaPrompt, ImagePromptService } from './image-prompt.service';
import {
  casarPorIndice,
  parseAnalysisResponse,
} from './image-analysis.contract';
import type {
  AlbumJudgement,
  AnalysisResponse,
  ImageJudgement,
} from './image-analysis.contract';
import { RoomKind } from './domain/image-analysis.enums';

/**
 * Que variante del fichero se le manda al modelo.
 *
 * La de 800 px, no la de 2560. El modelo trocea la imagen en cuadros y cobra
 * por cuadro: mandarle el archivo entero multiplica el precio por seis para
 * reconocer exactamente la misma cocina. A 800 px se distingue una alcoba de un
 * estudio, que es lo que se le pregunta.
 */
const VARIANTE = '-m.webp';

/**
 * Lo que un comprador espera ver de una vivienda antes de llamar.
 *
 * No es "todas las estancias": es la lista corta de las que, si faltan, cuestan
 * visitas. Nadie compra sin ver la cocina y el bano, y una ficha sin fachada no
 * se sabe ni donde esta.
 */
const IMPRESCINDIBLES_VIVIENDA: readonly RoomKind[] = [
  RoomKind.FACADE,
  RoomKind.LIVING,
  RoomKind.KITCHEN,
  RoomKind.BATHROOM,
  RoomKind.BEDROOM,
];

/**
 * Y de un lote o un local sin construir, donde una cocina no falta: no existe.
 */
const IMPRESCINDIBLES_SUELO: readonly RoomKind[] = [
  RoomKind.FACADE,
  RoomKind.EXTERIOR,
];

/** Una imagen del inmueble con su fichero ya leido de disco y ya medida. */
interface Cargada {
  image: PropertyImage;
  buffer: Buffer;
  /**
   * Lo que mide la puerta de codigo sobre el fichero ORIGINAL, no sobre la copia
   * de 800 px que se le manda al modelo.
   *
   * La distincion no es un detalle: midiendo la copia, las 6.306 fotos del
   * inventario salen "por debajo del minimo de 1024 px" y el modelo se pasa el
   * analisis entero diciendole al asesor que repita fotos que estan bien.
   */
  metricas: ImageMetrics | null;
  /** Cuanto ocupa la franja muerta de cada borde, sobre la copia que ve el modelo. */
  franjas: {
    arriba: number;
    abajo: number;
    izquierda: number;
    derecha: number;
  };
}

/**
 * Una fila de `image_analysis` a punto de escribirse: solo columnas.
 *
 * Quedan fuera las tres de la revision de privacidad, y no por comodidad: un
 * analisis recien hecho NO puede traer la revision de nadie. Esas columnas las
 * escribe una persona despues, por su propia ruta, y dejarlas aqui permitiria
 * que un reanalisis arrastrara un "ya lo miro Ana" que Ana no ha dicho sobre
 * esta respuesta. Por defecto la fila nace sin revisar, que es la verdad.
 */
type FilaAnalisis = Omit<
  ImageAnalysis,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'image'
  | 'privacyDismissed'
  | 'privacyReviewedAt'
  | 'privacyReviewedByAgentId'
>;

@Injectable()
export class ImageAnalysisService {
  private readonly logger = new Logger(ImageAnalysisService.name);

  constructor(
    @InjectRepository(ImageAnalysis)
    private readonly analyses: Repository<ImageAnalysis>,
    @InjectRepository(ImageAlbumAnalysis)
    private readonly albums: Repository<ImageAlbumAnalysis>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(PropertyImage)
    private readonly images: Repository<PropertyImage>,
    private readonly prompts: ImagePromptService,
    private readonly provider: OpenAiProvider,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    private readonly gate: ImageGateService,
    private readonly gateSettings: GateSettingsService,
  ) {}

  /** Si hay clave y esta encendido. Lo consulta el controller para dar 503. */
  get available(): boolean {
    return this.config.imageAi.enabled;
  }

  /**
   * Cuantas fotos entran en una llamada.
   *
   * Es un limite de DINERO, no de tecnica: cada imagen se paga, y pulsar
   * "analizar" en un inmueble de cuarenta fotos no puede lanzar cuarenta cobros
   * sin que nadie lo haya decidido. Veinte cubre casi todo el inventario de una
   * vez; lo que pase de ahi se pide en dos tandas, conscientemente.
   *
   * Se expone para que el panel lo pinte en el boton en lugar de escribirlo a
   * mano. La cifra vive en un solo sitio —`IMAGE_AI_MAX_IMAGES`— y de ahi la
   * leen los dos: el que cobra y el que promete.
   */
  get maxImages(): number {
    return this.config.imageAi.maxImages;
  }

  /**
   * Lo ya analizado de un inmueble, sin gastar nada.
   *
   * Existe para que abrir la pantalla NO llame al modelo. Es la mitad del
   * control de gasto: si leer costara dinero, cada vez que alguien entra en la
   * ficha se paga otra vez lo mismo.
   */
  async findForProperty(
    propertyId: string,
    actor: AuthenticatedActor,
  ): Promise<{
    images: ImageAnalysis[];
    album: ImageAlbumAnalysis | null;
    promptVersion: number;
    model: string;
    stale: boolean;
  }> {
    await this.propertyForActor(propertyId, actor);

    const [images, album, prompt] = await Promise.all([
      this.analyses.find({
        where: { propertyId },
        order: { createdAt: 'DESC' },
      }),
      this.albums.findOne({
        where: { propertyId },
        order: { createdAt: 'DESC' },
      }),
      this.prompts.active(),
    ]);

    // "Caducado" no es que este mal: es que se hizo con otro prompt u otro
    // modelo. Se dice para que el asesor sepa que lo que ve puede no coincidir
    // con lo que saldria si lo repitiera, y decida si le compensa pagarlo.
    const stale = images.some(
      (a) =>
        a.promptVersion !== prompt.version ||
        a.model !== this.config.imageAi.model,
    );

    return {
      images,
      album,
      promptVersion: prompt.version,
      model: this.config.imageAi.model,
      stale,
    };
  }

  /**
   * Analizar las fotos de un inmueble. Esto SI cuesta dinero.
   *
   * Solo lo alcanza el personal de la plataforma: la ruta vive en el controller
   * con sesion y rol, y ademas se comprueba aqui la sede y la propiedad del
   * inmueble. Ni el visitante de la web ni el propietario que manda una
   * solicitud de consignacion tienen por donde llegar: no hay ninguna ruta
   * publica que desemboque en este metodo, y las fotos de una solicitud se
   * analizan solo cuando un asesor abre esa solicitud y lo pide.
   *
   * Por defecto NO repite lo ya hecho con el mismo prompt y el mismo modelo:
   * repetir la misma pregunta es pagar dos veces por la misma respuesta. Con
   * `force` se repite, que es lo que hace falta justo despues de tocar el
   * prompt.
   */
  async analyzeProperty(
    propertyId: string,
    actor: AuthenticatedActor,
    opciones: { imageIds?: string[]; force?: boolean } = {},
  ): Promise<{
    batchId: string;
    analyzed: ImageAnalysis[];
    skipped: number;
    album: ImageAlbumAnalysis | null;
    usage: { inputTokens: number; outputTokens: number } | null;
    /**
     * Las fotos que el modelo no juzgo ni siquiera tras repetirselas. Va en la
     * respuesta para que la pantalla pueda decir la verdad: "analizadas 12 de
     * 15" en lugar de "analizadas 15".
     */
    unanalyzed: { id: string; url: string }[];
  }> {
    if (!this.available) {
      throw new ServiceUnavailableException(
        'El analisis de imagenes esta apagado: falta configurar la clave del proveedor.',
      );
    }

    const property = await this.propertyForActor(propertyId, actor);

    const todas = await this.images.find({
      where: opciones.imageIds?.length
        ? { propertyId, id: In(opciones.imageIds) }
        : { propertyId },
      order: { position: 'ASC' },
    });
    if (!todas.length) {
      throw new BadRequestException(
        'Este inmueble no tiene fotos que analizar',
      );
    }

    const prompt = await this.prompts.active();
    const model = this.config.imageAi.model;

    // Lo ya contestado con esta misma pregunta se deja fuera del lote.
    let candidatas = todas;
    if (!opciones.force) {
      const hechas = await this.analyses.find({
        where: {
          propertyImageId: In(todas.map((i) => i.id)),
          promptVersion: prompt.version,
          model,
        },
        select: { propertyImageId: true },
      });
      const ya = new Set(hechas.map((a) => a.propertyImageId));
      candidatas = todas.filter((i) => !ya.has(i.id));
    }
    const skipped = todas.length - candidatas.length;

    if (!candidatas.length) {
      return {
        batchId: '',
        analyzed: [],
        skipped,
        album: await this.albums.findOne({
          where: { propertyId },
          order: { createdAt: 'DESC' },
        }),
        usage: null,
        unanalyzed: [],
      };
    }

    const lote = candidatas.slice(0, this.config.imageAi.maxImages);
    if (candidatas.length > lote.length) {
      this.logger.log(
        `Inmueble ${property.code}: ${candidatas.length} fotos pendientes, se analizan ${lote.length} en este lote`,
      );
    }

    /*
      Los umbrales de la puerta, para poder decirle al modelo "esta movida" en
      lugar de un numero. Se leen una vez por lote y no por foto: son
      configuracion del panel, no dependen de la imagen.

      Perfil de inventario siempre, aunque las fotos hayan entrado por una
      solicitud: quien lee esto es el equipo decidiendo que se publica, y el
      liston de lo que se publica es el mismo venga la foto de donde venga.
    */
    const reglas = await this.gateSettings.rules(GateProfile.INVENTORY);

    const cargadas = await this.cargar(lote);
    if (!cargadas.length) {
      throw new BadRequestException(
        'No se pudo leer ninguno de los archivos de imagen en disco',
      );
    }

    const batchId = randomUUID();
    const promptHash = huellaPrompt(prompt.body);

    /*
      Se trocea, y esto NO es una optimizacion: es correccion.

      Medido sobre 50 llamadas reales, con lotes de 15 o 16 fotos el modelo
      devuelve un numero de entradas equivocado el 47 % de las veces — unas
      inventa una de mas y otras trunca en seco, contestando doce juicios para
      quince fotos. El JSON es valido, no hay error y el validador lo acepta;
      como se casa por indice, las fotos que faltan no se analizan y nadie se
      entera. Hasta doce fotos el fallo baja al 3 %.

      Y no se arregla en el prompt: ya se le pide ahi una entrada por imagen y
      lo incumple igual. Contar entradas es aritmetica, no juicio.
    */
    const tandas: Cargada[][] = [];
    for (let i = 0; i < cargadas.length; i += this.config.imageAi.chunkSize) {
      tandas.push(cargadas.slice(i, i + this.config.imageAi.chunkSize));
    }

    const emparejados: { cargada: Cargada; juicio: ImageJudgement }[] = [];
    /*
      Cada tanda devuelve su propio juicio de conjunto, con indices LOCALES a
      esa tanda. Se guarda junto a las fotos que la formaban porque sin ellas
      esos indices no significan nada.
    */
    const albumes: { tanda: Cargada[]; album: AlbumJudgement }[] = [];
    const sinAnalizar: Cargada[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let modelo = model;

    for (const tanda of tandas) {
      const r = await this.preguntarTanda(
        property,
        tanda,
        prompt.body,
        model,
        reglas,
      );
      inputTokens += r.usage?.inputTokens ?? 0;
      outputTokens += r.usage?.outputTokens ?? 0;
      modelo = r.model;
      if (r.album) albumes.push({ tanda, album: r.album });

      const faltan: Cargada[] = [];
      tanda.forEach((cargada, i) => {
        const juicio = r.juicios.get(i);
        if (juicio) emparejados.push({ cargada, juicio });
        else faltan.push(cargada);
      });

      /*
        Lo que no volvio se vuelve a pedir, una vez y solo eso.

        Reintentar sale barato —una foto suelta cuesta lo que costaba dentro del
        lote— y arregla el caso comun, que es el truncado. Una sola vez porque
        si el modelo no quiere ver una foto concreta, insistir es pagar lo mismo
        por el mismo silencio; a la segunda se dice que quedo sin analizar, que
        es lo unico que no se podia hacer antes.
      */
      if (faltan.length) {
        this.logger.warn(
          `${property.code}: el modelo devolvio ${r.juicios.size} juicios para ${tanda.length} fotos; se repiten ${faltan.length}`,
        );
        const reintento = await this.preguntarTanda(
          property,
          faltan,
          prompt.body,
          model,
          reglas,
        );
        inputTokens += reintento.usage?.inputTokens ?? 0;
        outputTokens += reintento.usage?.outputTokens ?? 0;
        faltan.forEach((cargada, i) => {
          const juicio = reintento.juicios.get(i);
          if (juicio) emparejados.push({ cargada, juicio });
          else sinAnalizar.push(cargada);
        });
      }
    }

    if (!emparejados.length) {
      throw new ServiceUnavailableException(
        'El modelo no devolvio ningun juicio utilizable. Vuelve a intentarlo; si se repite, revisa el prompt.',
      );
    }

    const analyzed = await this.guardar(emparejados, {
      batchId,
      promptVersion: prompt.version,
      promptHash,
      model: modelo,
      actor,
      reglas,
    });

    const album = albumes.length
      ? await this.guardarAlbum(propertyId, emparejados, albumes, {
          batchId,
          promptVersion: prompt.version,
          promptHash,
          model: modelo,
          actor,
          property,
          rooms: analyzed.map((a) => a.room),
        })
      : null;

    /*
      Lo que quedo sin analizar SE DICE, no se calla.

      Es el punto entero de este cambio: una pantalla que promete "analizadas
      15" cuando el modelo contesto por 12 es peor que no tener la funcion,
      porque el asesor cree que alguien miro esas tres fotos. Y la que se cayo
      puede ser justo la que llevaba una cara en la calle.
    */
    if (sinAnalizar.length) {
      this.logger.error(
        `${property.code}: ${sinAnalizar.length} fotos quedaron sin analizar tras el reintento`,
      );
    }

    this.logger.log(
      `Analizadas ${analyzed.length} de ${cargadas.length} fotos de ${property.code} en ${tandas.length} tanda(s) (prompt v${prompt.version}, ${modelo}, ${inputTokens} tokens de entrada)`,
    );

    return {
      batchId,
      analyzed,
      skipped,
      album,
      usage: { inputTokens, outputTokens },
      unanalyzed: sinAnalizar.map((c) => ({
        id: c.image.id,
        url: c.image.url,
      })),
    };
  }

  /**
   * Una llamada al modelo con un pu\u00f1ado de fotos, y lo que devuelve casado por
   * indice.
   *
   * Devuelve un mapa y no una lista a proposito: lo que interesa de la respuesta
   * es "¿hay juicio para la foto numero 3?", y un mapa contesta eso sin que
   * nadie tenga que confiar en que vengan tantas entradas como fotos — que es
   * justo lo que el modelo incumple.
   *
   * Los indices que se salen del tramo enviado se descartan aqui: cuando el
   * modelo inventa una entrada 15 en una tanda de 12, esa entrada no describe
   * ninguna foto real y guardarla seria inventarse un juicio.
   */
  private async preguntarTanda(
    property: Property,
    tanda: Cargada[],
    system: string,
    model: string,
    reglas: GateRules,
  ): Promise<{
    juicios: Map<number, ImageJudgement>;
    album: AlbumJudgement | null;
    usage: { inputTokens: number; outputTokens: number } | null;
    model: string;
  }> {
    const respuesta = await this.provider.seeJson({
      model,
      system,
      user: this.contexto(property, tanda, reglas),
      images: tanda.map((c): VisionImage => ({
        mimeType: 'image/webp',
        data: c.buffer,
        detail: this.config.imageAi.detail,
      })),
      maxOutputTokens: this.config.imageAi.maxOutputTokens,
    });

    let parsed: AnalysisResponse;
    try {
      parsed = parseAnalysisResponse(respuesta.content);
    } catch (error) {
      this.logger.error(
        `Respuesta ilegible del modelo para ${property.code}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'El modelo devolvio algo que no pudimos interpretar. Vuelve a intentarlo; si se repite, revisa el prompt: puede que se le haya pedido que conteste de otra forma.',
      );
    }

    return {
      juicios: casarPorIndice(parsed.images, tanda.length),
      album: parsed.album ?? null,
      usage: respuesta.usage,
      model: respuesta.model,
    };
  }

  /**
   * Un asesor dice si la marca de datos personales es real o no lo es.
   *
   * Se guarda QUIEN y CUANDO, no solo el booleano. Lo valioso no es el
   * descarte: es poder contestar dentro de seis meses a "¿quien dijo que esa
   * cara no era nada?". Un descarte anonimo sobre una marca de riesgo legal es
   * peor que no poder descartar, porque aparenta que alguien se hizo cargo.
   *
   * El asesor sale del token, nunca del cuerpo de la peticion: si viniera de
   * fuera, cualquiera podria firmar la revision con el nombre de otro — y el
   * nombre es justo lo unico que este registro aporta.
   *
   * Reabrir (`dismissed: false`) borra la firma en vez de conservarla. Una
   * marca reabierta esta sin revisar, y dejar ahi el nombre de quien la cerro
   * una vez haria creer que sigue habiendo alguien detras.
   */
  async reviewPrivacy(
    analysisId: string,
    dismissed: boolean,
    actor: AuthenticatedActor,
  ): Promise<ImageAnalysis> {
    const fila = await this.analyses.findOne({ where: { id: analysisId } });
    if (!fila) throw new NotFoundException('Analisis no encontrado');

    // Las mismas comprobaciones de sede y propiedad que para analizar: quien no
    // puede tocar el inmueble tampoco decide sobre sus datos personales.
    await this.propertyForActor(fila.propertyId, actor);

    await this.analyses.update(
      { id: analysisId },
      dismissed
        ? {
            privacyDismissed: true,
            privacyReviewedAt: new Date(),
            privacyReviewedByAgentId: actor.id,
          }
        : {
            privacyDismissed: false,
            privacyReviewedAt: null,
            privacyReviewedByAgentId: null,
          },
    );

    this.logger.log(
      `${actor.id} ${dismissed ? 'descarta' : 'reabre'} la marca de datos personales de ${analysisId}`,
    );
    return (await this.analyses.findOne({ where: { id: analysisId } }))!;
  }

  // --- piezas ---------------------------------------------------------------

  /**
   * El inmueble, comprobando que este actor puede tocarlo.
   *
   * Las dos comprobaciones de siempre —sede y propiedad— y no una version
   * propia: un modulo nuevo que se invente sus reglas de visibilidad es un
   * agujero que nadie sabe que existe.
   */
  private async propertyForActor(
    propertyId: string,
    actor: AuthenticatedActor,
  ): Promise<Property> {
    const property = await this.properties.findOne({
      where: { id: propertyId },
    });
    if (!property) {
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);
    }
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');
    return property;
  }

  /** Lee de disco las variantes de 800 px. Lo que falte se salta. */
  private async cargar(imagenes: PropertyImage[]): Promise<Cargada[]> {
    const salida: Cargada[] = [];
    for (const image of imagenes) {
      const key = image.storageKey.replace(/-o\.webp$/, VARIANTE);
      let buffer: Buffer;
      try {
        buffer = await readFile(join(this.storage.root, key));
      } catch {
        // Un fichero que falta no puede tumbar el lote: se analiza el resto y
        // esa foto se queda sin juicio, que es exactamente lo que pasa.
        this.logger.warn(`No esta en disco: ${key}`);
        continue;
      }

      /*
        Las medidas de nitidez y exposicion salen del ORIGINAL, no de la copia
        de 800 px que se le manda al modelo, y la diferencia importa: la copia
        esta por debajo del minimo de 1024 px SIEMPRE, asi que midiendola el
        analisis entero acabaria diciendo que las 6.306 fotos hay que
        repetirlas. Las franjas, en cambio, se miden sobre la copia: son
        proporciones del encuadre y no cambian con el tamaño, y asi se mide lo
        mismo que el modelo esta viendo.
      */
      let metricas: ImageMetrics | null = null;
      try {
        metricas = await this.gate.measure(
          await readFile(join(this.storage.root, image.storageKey)),
        );
      } catch {
        // Sin original legible se sigue adelante sin sus cifras: el juicio del
        // modelo vale igual, solo se pierde el poder decir "esta movida".
        this.logger.debug(`Sin original para medir: ${image.storageKey}`);
      }

      let franjas = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
      try {
        franjas = await this.gate.deadBands(buffer);
      } catch {
        // Sin franjas no se confirma ningun recorte, que es el lado seguro:
        // las propuestas quedan para que las mire una persona.
        this.logger.debug(`No se pudieron medir las franjas de: ${key}`);
      }

      salida.push({ image, buffer, metricas, franjas });
    }
    return salida;
  }

  /**
   * El mensaje de usuario: de que inmueble hablamos y que midio la puerta.
   *
   * Se le dan al modelo las cifras que YA sabemos con certeza —tamano,
   * orientacion— para que no gaste su atencion en adivinarlas y para que no
   * contradiga a la puerta de codigo delante del asesor.
   */
  private contexto(
    property: Property,
    cargadas: Cargada[],
    reglas: GateRules,
  ): string {
    const ficha = [
      `Inmueble ${property.code}: ${property.title}`,
      property.bedrooms ? `${property.bedrooms} alcobas` : null,
      property.bathrooms ? `${property.bathrooms} banos` : null,
      property.builtArea ? `${property.builtArea} m2 construidos` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const lineas = cargadas.map((c, i) => this.linea(i, c, reglas));

    return [
      ficha,
      '',
      `Te mando ${cargadas.length} fotos de este inmueble, en este orden:`,
      ...lineas,
      '',
      'Devuelve el JSON con una entrada por foto y el juicio del conjunto.',
    ].join('\n');
  }

  /**
   * La linea que acompaña a cada foto: lo que ya se sabe de ella con certeza.
   *
   * El prompt le promete al modelo que "la resolucion, la orientacion, la
   * nitidez y la exposicion te llegan escritas junto a cada imagen". Hasta
   * ahora solo le llegaba el tamaño, asi que esa frase era falsa y el modelo
   * opinaba igualmente sobre si una foto estaba movida — que es justo lo que se
   * queria evitar.
   *
   * Se dice en palabras y no en cifras a proposito. "Movida" es accionable;
   * "nitidez 63,4" obliga al modelo a comparar contra un umbral que no conoce,
   * y comparar numeros es lo que hace peor.
   */
  private linea(i: number, c: Cargada, reglas: GateRules): string {
    const { width, height } = c.image;
    const partes: string[] = [];
    partes.push(
      width && height
        ? `${width}x${height} px (${
            width > height
              ? 'horizontal'
              : width === height
                ? 'cuadrada'
                : 'vertical'
          })`
        : 'sin medidas',
    );

    const m = c.metricas;
    if (m) {
      if (m.width < reglas.minWidth)
        partes.push(
          'POR DEBAJO del minimo, no se puede publicar a buen tamaño',
        );
      else if (m.width < reglas.recommendedWidth)
        partes.push('corta para la ficha');

      /*
        Oscura antes que movida, y nunca las dos: una foto a oscuras pierde
        contraste local, asi que la varianza del laplaciano se hunde y sale
        "movida" aunque el enfoque sea perfecto. Es la misma regla que aplica la
        puerta al avisar, y decirle al modelo las dos cosas seria pedirle que
        contradiga a la unica que es cierta.
      */
      const oscura =
        m.brightness < reglas.minBrightness ||
        m.darkFraction > reglas.maxDarkFraction;
      if (oscura) partes.push('oscura');
      else if (m.sharpness < reglas.minSharpness)
        partes.push('movida o desenfocada');
      if (
        m.brightness > reglas.maxBrightness ||
        m.brightFraction > reglas.maxBrightFraction
      ) {
        partes.push('quemada de luces');
      }
    }

    if (c.image.isMain) partes.push('hoy es la portada');
    return `  ${i}: ${partes.join(' — ')}`;
  }

  /**
   * Guarda un juicio por foto.
   *
   * `upsert` sobre (imagen, version del prompt, modelo): repetir la misma
   * pregunta pisa la respuesta anterior, y preguntar con otro prompt deja una
   * fila nueva. Esa es justo la diferencia que hace posible comparar si un
   * cambio del prompt mejoro o empeoro.
   */
  private async guardar(
    emparejados: { cargada: Cargada; juicio: ImageJudgement }[],
    ctx: {
      batchId: string;
      promptVersion: number;
      promptHash: string;
      model: string;
      actor: AuthenticatedActor;
      /** Los umbrales con los que se decide si una foto tiene arreglo. */
      reglas: GateRules;
    },
  ): Promise<ImageAnalysis[]> {
    /*
      Objetos planos y no entidades creadas con `repo.create`.

      `upsert` pide `QueryDeepPartialEntity`, y una entidad viva arrastra sus
      relaciones (`image`, y desde ella `property` y sus imagenes) que no
      encajan en ese tipo. Lo que se escribe son columnas, asi que se escriben
      columnas, y la conversion se hace una sola vez al llamar a `upsert`:
      `QueryDeepPartialEntity` se mete tambien dentro del `jsonb` de `metrics` y
      alli un `number | null` deja de encajar, cosa que no significa nada porque
      esa columna viaja serializada.
    */
    const filas: FilaAnalisis[] = [];

    /*
      Llegan ya casados. El emparejado por indice se hace en `preguntarTanda`,
      que es donde se sabe cuantas fotos se enviaron: aqui ya no hay forma de
      guardar un juicio sin dueño.
    */
    for (const { cargada, juicio } of emparejados) {
      filas.push({
        propertyImageId: cargada.image.id,
        propertyId: cargada.image.propertyId,
        room: juicio.room,
        roomConfidence: juicio.roomConfidence,
        quality: Math.round(juicio.quality),
        coverScore: Math.round(juicio.coverScore),
        caption: juicio.caption || null,
        issues: juicio.issues,
        fixes: juicio.fixes,
        privacy: juicio.privacy,
        framing: this.encuadre(cargada, juicio, ctx.reglas),
        usable: juicio.usable,
        promptVersion: ctx.promptVersion,
        promptHash: ctx.promptHash,
        model: ctx.model,
        batchId: ctx.batchId,
        metrics: {
          width: cargada.image.width,
          height: cargada.image.height,
          bytes: cargada.image.bytes,
        },
        createdByAgentId: ctx.actor.id,
      });
    }

    if (!filas.length) return [];

    await this.analyses.upsert(
      filas as QueryDeepPartialEntity<ImageAnalysis>[],
      {
        conflictPaths: ['propertyImageId', 'promptVersion', 'model'],
        skipUpdateIfNoValuesChanged: false,
      },
    );

    return this.analyses.find({
      where: {
        propertyImageId: In(filas.map((f) => f.propertyImageId)),
        promptVersion: ctx.promptVersion,
        model: ctx.model,
      },
    });
  }

  /**
   * La propuesta de encuadre de una foto: lo que ve el modelo, contrastado con
   * lo que mide el codigo.
   *
   * El reparto esta explicado entero en `framing.ts`. Aqui solo se traduce lo
   * que sabe este servicio —las cifras de la puerta y el juicio del modelo— al
   * `EstadoFisico` que aquella funcion necesita para decidir.
   */
  private encuadre(
    cargada: Cargada,
    juicio: ImageJudgement,
    reglas: GateRules,
  ): Encuadre {
    const m = cargada.metricas;

    const estado: EstadoFisico = {
      /*
        "Irrecuperable" se decide con la medida, no con la opinion: una foto
        movida no se salva recortandola, y eso ya lo sabe la puerta. Lo oscuro
        se antepone a lo movido por la misma razon que en `linea`: a oscuras la
        varianza del laplaciano se hunde sola.
      */
      irrecuperable: Boolean(
        m &&
        reglas &&
        (m.brightness < reglas.minBrightness ||
          m.darkFraction > reglas.maxDarkFraction ||
          m.brightness > reglas.maxBrightness ||
          m.brightFraction > reglas.maxBrightFraction ||
          m.sharpness < reglas.minSharpness),
      ),
      pequena: Boolean(m && m.width < reglas.minWidth),
      /*
        Que no sea una foto del inmueble lo decide el modelo, porque es lo unico
        de los tres que hay que MIRAR: el logo sobre fondo liso, un plano o una
        captura de pantalla. La nota por debajo de 11 es como el prompt le pide
        que lo diga desde hace tiempo, asi que no hay que preguntarselo otra vez.
      */
      noEsFoto:
        juicio.quality < 11 ||
        juicio.room === RoomKind.FLOOR_PLAN ||
        !juicio.usable,
    };

    return resolverEncuadre(juicio.encuadre, cargada.franjas, estado);
  }

  /** Guarda el juicio del conjunto, traduciendo indices del lote a ids. */
  private async guardarAlbum(
    propertyId: string,
    emparejados: { cargada: Cargada; juicio: ImageJudgement }[],
    albumes: { tanda: Cargada[]; album: AlbumJudgement }[],
    ctx: {
      batchId: string;
      promptVersion: number;
      promptHash: string;
      model: string;
      actor: AuthenticatedActor;
      property: Property;
      /** Las estancias que el modelo acaba de asignar a estas fotos. */
      rooms: RoomKind[];
    },
  ): Promise<ImageAlbumAnalysis> {
    /*
      El orden, cosido de los ordenes de cada tanda.

      Cada juicio de conjunto ordena SU tanda, y las tandas van en el orden en
      que estaban las fotos, asi que concatenarlas da un recorrido coherente.
      Lo que ninguna tanda puede hacer es comparar una foto suya con otra de la
      tanda de al lado; para eso esta el `coverScore`, que si es comparable
      porque es una nota, no una posicion.
    */
    const vistos = new Set<string>();
    const orden: string[] = [];
    for (const { tanda, album } of albumes) {
      for (const i of album.suggestedOrder) {
        const id = tanda[i]?.image.id;
        if (id && !vistos.has(id)) {
          vistos.add(id);
          orden.push(id);
        }
      }
    }
    // Lo que ninguna tanda coloco va al final, en el orden que ya tenia: una
    // sugerencia de orden que pierde fotos no se puede aplicar.
    for (const { cargada } of emparejados) {
      if (!vistos.has(cargada.image.id)) orden.push(cargada.image.id);
    }

    /*
      La portada es la mejor nota de portada de TODO el inmueble, y se pone la
      primera del orden.

      Antes se tomaba la primera del orden y ya, que con una sola llamada era lo
      mismo. Troceando deja de serlo: la primera del orden es la mejor de la
      primera tanda, y la fachada puede haber caido en la segunda. Comparar
      notas entre tandas si se puede hacer aqui —son numeros— y es justo lo que
      el modelo no podia hacer al no ver las fotos juntas.

      Al moverla al frente, `orden[0]` y la portada siguen siendo la misma cosa
      por construccion, que era el motivo de derivarla en codigo.

      Que esto se apoye en `coverScore` esta medido: sobre 175 fotos la nota usa
      el rango entero (5 a 95, mediana 55) y castiga de verdad —los banios y las
      zonas de ropas caen a 5-20—, al contrario que `quality`, que se apelotona
      arriba si no se le ancla la escala. Y repitiendo el analisis, la portada
      sale la misma en 11 de 13 albumes aunque la nota baile cinco puntos: lo
      unico que se usa aqui es el orden relativo, no el valor.

      Donde deja de ser estable, para quien se lo encuentre: en los albumes
      SIN una foto que domine. Los dos casos que bailaron eran uno sin fachada
      ninguna y otro con la fachada compitiendo con una panoramica de la ciudad
      — y ahi las dos candidatas eran defendibles, asi que "inestable" no
      significa "mal". Cuando hay fachada, gana siempre.

      Se descarto desempatar por `room` cuando la diferencia sea de pocos
      puntos: arreglaria 2 albumes de 13 a cambio de un umbral inventado sin
      medir, y el sintoma que evitaria es que una SUGERENCIA cambie entre dos
      ejecuciones. Aplicarla sigue siendo un gesto de una persona.
    */
    const mejor = emparejados.reduce<{ id: string; nota: number } | null>(
      (actual, { cargada, juicio }) =>
        !actual || juicio.coverScore > actual.nota
          ? { id: cargada.image.id, nota: juicio.coverScore }
          : actual,
      null,
    );
    if (mejor) {
      const i = orden.indexOf(mejor.id);
      if (i > 0) orden.splice(i, 1);
      if (i !== 0) orden.unshift(mejor.id);
    }

    const summary = albumes
      .map((a) => a.album.summary)
      .filter(Boolean)
      .join(' ')
      .slice(0, 2000);

    return this.albums.save(
      this.albums.create({
        propertyId,
        batchId: ctx.batchId,
        suggestedOrder: orden,
        coverImageId: orden[0] ?? null,
        missing: this.calcularQueFalta(ctx.property, ctx.rooms),
        summary: summary || null,
        promptVersion: ctx.promptVersion,
        promptHash: ctx.promptHash,
        model: ctx.model,
        createdByAgentId: ctx.actor.id,
      }),
    );
  }

  /**
   * Que estancias faltan, restando conjuntos.
   *
   * Esto lo pedia el prompt y lo contestaba el modelo, y salia mal de una forma
   * muy concreta: decia que faltaba la cocina en albumes donde el mismo acababa
   * de clasificar una foto como cocina. Se contradecia dentro de la misma
   * respuesta, porque no es una pregunta de criterio — es una resta, y una
   * resta no se le pide a un modelo de lenguaje.
   *
   * Que se considera imprescindible depende de lo que sea el inmueble: en un
   * lote la cocina no falta, no existe. Se decide por lo que la propia ficha
   * declara, no por lo que opine nadie.
   *
   * Solo mira el lote analizado. Si un inmueble tiene treinta fotos y se han
   * analizado veinte, "falta la cocina" puede querer decir que esta en las diez
   * restantes; por eso el panel enseña cuantas quedan sin analizar al lado.
   */
  private calcularQueFalta(property: Property, rooms: RoomKind[]): RoomKind[] {
    // Sin alcobas ni area construida no es una vivienda: es suelo.
    const esVivienda = Boolean(property.bedrooms || property.builtArea);
    const esperadas = esVivienda
      ? IMPRESCINDIBLES_VIVIENDA
      : IMPRESCINDIBLES_SUELO;

    const hay = new Set(rooms);
    // La fachada se da por vista si hay cualquier toma del exterior: en un
    // apartamento en altura, "la fachada" suele ser una foto del edificio
    // clasificada como EXTERIOR, y exigir las dos seria inventarse una falta.
    if (hay.has(RoomKind.EXTERIOR)) hay.add(RoomKind.FACADE);

    return esperadas.filter((r) => !hay.has(r));
  }
}
