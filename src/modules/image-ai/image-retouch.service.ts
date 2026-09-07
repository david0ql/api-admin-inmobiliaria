import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { join } from 'node:path';
import { AppConfigService } from '../../shared/config/app-config.service';
import { StorageService } from '../media/storage.service';
import { OpenAiProvider } from '../assistant/openai-provider';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { assertCanMutate, assertSameBranch } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ImageRetouch } from './domain/image-retouch.entity';
import type { InstantaneaImagen } from './domain/image-retouch.entity';
import {
  RETOUCH_KIND_LABEL,
  RetouchKind,
  RetouchStatus,
} from './domain/image-retouch.enums';
import {
  clasificarInstruccion,
  encabezadoDocumental,
} from './retouch-frontier';
import { INSTRUCCION_POR_DEFECTO } from './dto/image-retouch.dto';
import type { RetouchDto } from './dto/image-retouch.dto';

/**
 * Que variante se le manda al modelo: el archivo de 2560 px.
 *
 * Al reves que el analisis, que manda la de 800 px porque solo tiene que
 * distinguir una cocina de una alcoba. Aqui lo que vuelve ES la foto del
 * anuncio, asi que partir de la version pequeña seria pagar por un retoque y
 * quedarse ademas con menos resolucion de la que ya habia. Se manda lo mejor
 * que tenemos.
 */
const VARIANTE_ORIGEN = '-o.webp';

/**
 * Lo que cobra OpenAI por `gpt-image-2`, en dolares por millon de tokens.
 *
 * Fuente: la tabla de precios de la API de OpenAI
 * (developers.openai.com/api/docs/pricing), consultada el 6 de septiembre de
 * 2026. Se comprobo contra una llamada real: una foto de 1584x1056 en calidad
 * alta consumio 1.504 tokens de imagen de entrada, 100 de texto y 5.642 de
 * salida, o sea 0,1818 USD.
 *
 * Vive en el codigo y no en la base porque es un dato del proveedor, no una
 * preferencia de la agencia; y se aplica sobre los tokens que devuelve la
 * propia respuesta, de modo que el dia que estos numeros se queden viejos lo
 * que falle sea la estimacion en pesos, nunca el registro de lo que se
 * consumio de verdad.
 */
const PRECIO_USD_POR_MILLON = {
  imagenEntrada: 8,
  textoEntrada: 5,
  salida: 30,
} as const;

/**
 * Cuanto suele costar una foto, para poder avisar ANTES de cobrar.
 *
 * Medido sobre fotos reales del catalogo, no estimado de una tabla de precios:
 *
 *   1584x1056, calidad media -> 0,055 USD
 *   1584x1056, calidad alta  -> 0,182 USD
 *   2128x1424, calidad alta  -> 0,245 USD
 *
 * Los numeros de aqui son los del ultimo caso, que es el real: se retoca
 * siempre la variante de archivo, que en este catalogo ronda los 2.500 px de
 * ancho. Citar el precio de una foto mas pequeña seria quedarse corto en el
 * unico numero que el asesor mira antes de pulsar.
 *
 * Es orientativo Y SE DICE que lo es: el coste depende del tamaño de salida, y
 * el que se guarda en la fila es siempre el real, calculado con los tokens que
 * devolvio el proveedor.
 */
const COSTE_ORIENTATIVO_USD: Record<string, number> = {
  low: 0.03,
  medium: 0.075,
  high: 0.245,
  auto: 0.245,
};

/**
 * Limites de `gpt-image-2` para el tamaño de salida: lados multiplos de 16, el
 * mayor de 3840 px como maximo, proporcion de 3:1 como mucho y entre 655.360 y
 * 8.294.400 pixeles en total.
 */
/**
 * Lo que cuesta ANALIZAR una foto, para poder decir cuantas veces mas cuesta
 * retocarla.
 *
 * Una imagen a 800 px con `detail: low` son unos 85 tokens de entrada mas la
 * parte proporcional de la respuesta del lote; con `gpt-4.1-mini` sale del
 * orden de medio milesimo de dolar. Es un orden de magnitud, no una factura, y
 * se usa solo para la comparacion — el gasto real del analisis lo lleva su
 * propio modulo.
 */
const COSTE_ANALISIS_USD = 0.0005;

const LADO_MULTIPLO = 16;
const LADO_MAXIMO = 3840;
const PIXELES_MINIMOS = 655_360;
const PIXELES_MAXIMOS = 8_294_400;

/**
 * Retoque de UNA foto, pedido por una persona, mirado por una persona.
 *
 * Las tres cosas que este servicio no hace, y que son las que lo definen:
 *
 * 1. NO retoca en lote ni al subir. Una llamada, una foto, una pulsacion. El
 *    analisis puede permitirse un lote porque cuesta decimas de centavo y no
 *    cambia el anuncio; esto cuesta cien veces mas y SI cambia el anuncio.
 * 2. NO aplica lo que produce. Deja el resultado en `PENDIENTE` y espera. Un
 *    retoque que se aplicara solo seria un inmueble anunciado distinto de como
 *    es sin que nadie lo hubiera mirado.
 * 3. NO borra el original. Nunca. Ni al aplicar ni al retocar por segunda vez.
 */
@Injectable()
export class ImageRetouchService {
  private readonly logger = new Logger(ImageRetouchService.name);

  constructor(
    @InjectRepository(ImageRetouch)
    private readonly retouches: Repository<ImageRetouch>,
    @InjectRepository(PropertyImage)
    private readonly images: Repository<PropertyImage>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly provider: OpenAiProvider,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  get available(): boolean {
    return this.config.retouch.enabled;
  }

  /**
   * Lo que cuesta un retoque y lo que cuesta un analisis, juntos.
   *
   * Van juntos porque separados no dicen nada. "0,245 USD" no le situa el gasto
   * a nadie; "0,245 USD, unas quinientas veces lo que cuesta analizarla" si. El
   * panel arma la frase con los dos numeros, y salen los dos de aqui para que
   * el dia que se cambie de modelo se muevan a la vez — una comparacion en la
   * que solo se actualiza una mitad miente mas que no ponerla.
   */
  get costes() {
    return {
      /*
        Se llaman igual que en `/retouch/preview`, que es el otro sitio donde
        salen. Un mismo numero con dos nombres segun el endpoint obliga a quien
        pinta la pantalla a acordarse de cual toca, y ahi es donde se pierde:
        el panel leia `costeAnalisisUsd` de aqui y aqui se publicaba
        `analisisUsd`, asi que la frase con el multiplicador no se encendia
        nunca y nadie veia un error — solo faltaba media frase.
      */
      costeOrientativoUsd:
        COSTE_ORIENTATIVO_USD[this.config.retouch.quality] ?? null,
      costeAnalisisUsd: COSTE_ANALISIS_USD,
      moneda: 'USD',
    };
  }

  /**
   * Que pasaria si se pulsara, sin pulsar.
   *
   * Gratis y a proposito: la clasificacion es lexica y no llama a nadie. Es lo
   * que permite que el panel enseñe la advertencia y el precio MIENTRAS el
   * asesor escribe, en vez de despues de cobrarle. Una advertencia que llega
   * despues del cobro no es una advertencia, es un recibo.
   */
  previsualizar(instruccion: string) {
    const veredicto = clasificarInstruccion(instruccion);
    const { quality, model } = this.config.retouch;
    return {
      kind: veredicto.kind,
      kindLabel: RETOUCH_KIND_LABEL[veredicto.kind],
      motivos: veredicto.motivos,
      advertencia: veredicto.advertencia,
      /** Si hara falta marcar la casilla de "se lo que hago". */
      requiereConfirmacion: veredicto.kind !== RetouchKind.REVELADO,
      costeOrientativoUsd: COSTE_ORIENTATIVO_USD[quality] ?? null,
      model,
      quality,
    };
  }

  /**
   * Lo que el panel tiene que enseñar de una foto: el retoque que manda.
   *
   * El mas reciente que siga vivo —en curso, listo para decidir o ya aplicado—.
   * Los descartados, los revertidos y los fallidos no se devuelven aqui aunque
   * sigan en la tabla: la pantalla pregunta "que hay ahora con esta foto", y la
   * respuesta a eso no es un intento que alguien ya rechazo. El historial
   * completo, con lo que costo cada intento, esta en `listarPorImagen`.
   */
  async actualPorImagen(
    imageId: string,
    actor: AuthenticatedActor,
  ): Promise<ImageRetouch> {
    await this.cargarImagen(imageId, actor);
    const fila = await this.retouches.findOne({
      where: [
        { propertyImageId: imageId, status: RetouchStatus.PROCESANDO },
        { propertyImageId: imageId, status: RetouchStatus.PENDIENTE },
        { propertyImageId: imageId, status: RetouchStatus.APLICADO },
      ],
      order: { createdAt: 'DESC' },
    });
    // 404 y no `null`: el panel esconde el boton de decidir cuando no hay nada
    // que decidir, y distinguir "no hay" de "hubo un error" importa.
    if (!fila) throw new NotFoundException('Esta foto no tiene ningun retoque');
    return fila;
  }

  /**
   * Volver al original desde la foto, sin saber el id del retoque.
   *
   * El panel ofrece "Volver a la foto original" desde la galeria, donde lo
   * unico que se tiene a mano es la imagen. Busca el retoque aplicado y lo
   * revierte.
   */
  async revertirPorImagen(
    imageId: string,
    actor: AuthenticatedActor,
  ): Promise<ImageRetouch> {
    await this.cargarImagen(imageId, actor, { paraEscribir: true });
    const fila = await this.retouches.findOne({
      where: { propertyImageId: imageId, status: RetouchStatus.APLICADO },
      order: { createdAt: 'DESC' },
    });
    if (!fila) {
      throw new NotFoundException(
        'Esta foto no tiene ningun retoque aplicado: ya es la original',
      );
    }
    return this.revertir(fila.id, actor);
  }

  /** Los retoques de una foto, del mas nuevo al mas viejo. */
  async listarPorImagen(imageId: string, actor: AuthenticatedActor) {
    await this.cargarImagen(imageId, actor);
    return this.retouches.find({
      where: { propertyImageId: imageId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Pide el retoque, lo paga y lo deja esperando decision.
   *
   * El orden de las comprobaciones importa: todo lo que puede decir que no
   * —permisos, tope de intentos, confirmacion de que altera la realidad— va
   * ANTES de la llamada al proveedor. Comprobar despues seria pagar por algo
   * que ibamos a rechazar de todas formas.
   */
  async retocar(
    imageId: string,
    dto: RetouchDto,
    actor: AuthenticatedActor,
  ): Promise<ImageRetouch> {
    if (!this.available) {
      throw new ServiceUnavailableException(
        'El retoque con IA no esta disponible: falta configurarlo',
      );
    }

    const { image } = await this.cargarImagen(imageId, actor, {
      paraEscribir: true,
    });

    /*
      Sin instruccion se hace el revelado conservador. Es lo que manda el panel
      cuando el asesor solo pulsa "retocar", y tiene que ser el subconjunto
      seguro: un valor por defecto capaz de cambiar la escena convertiria ese
      boton en una alteracion que nadie pidio.
    */
    const instruccion = (dto.instruction ?? INSTRUCCION_POR_DEFECTO).trim();

    const veredicto = clasificarInstruccion(instruccion);

    /*
      La confirmacion explicita. Es lo unico que este servicio impone de verdad,
      y no impide nada: solo obliga a que quien altera la realidad de un
      inmueble lo diga con todas las letras.

      No se bloquea ni siquiera `OCULTA_DEFECTO`, porque el codigo no sabe lo
      que el asesor sabe —puede que la humedad ya se reparara y la foto sea de
      antes— y una herramienta que decide por su cuenta acaba esquivada. Lo que
      no puede pasar es que alguien altere un anuncio sin enterarse.
    */
    if (veredicto.kind !== RetouchKind.REVELADO && !dto.alteracionAsumida) {
      throw new BadRequestException(
        `${veredicto.advertencia} Si aun asi quieres hacerlo, vuelve a enviarlo confirmando que asumes que la foto dejara de mostrar el inmueble tal y como esta.`,
      );
    }

    const intentos = await this.retouches.count({
      where: { propertyImageId: imageId },
    });
    const tope = this.config.retouch.maxPerImage;
    if (intentos >= tope) {
      throw new BadRequestException(
        `Esta foto ya se ha retocado ${intentos} veces, que es el tope. Cada intento se cobra aunque se descarte.`,
      );
    }

    const { model, quality } = this.config.retouch;
    const prompt = `${encabezadoDocumental(veredicto.kind)}\n\nLo que se pide: ${instruccion}`;
    const size = this.tamanoSalida(image.width, image.height);

    /*
      La instantanea del original se toma ANTES de llamar a nadie. Si se tomara
      despues y la llamada tardara minuto y medio —tarda entre 90 y 100
      segundos—, otra pulsacion podria haber cambiado la foto por el camino y
      estariamos guardando como "original" algo que ya era un retoque.
    */
    const fila = await this.retouches.save(
      this.retouches.create({
        propertyImageId: image.id,
        propertyId: image.propertyId,
        instruction: instruccion,
        kind: veredicto.kind,
        motivos: veredicto.motivos,
        promptEnviado: prompt,
        model,
        quality,
        size,
        originalSnapshot: this.instantanea(image),
        retouchedSnapshot: null,
        status: RetouchStatus.PROCESANDO,
        requestedByAgentId: actor.id,
        alteracionAsumida: Boolean(dto.alteracionAsumida),
        error: null,
      }),
    );

    /*
      Y aqui se devuelve, sin esperar. La edicion tarda entre 90 y 100 segundos
      medidos, y una peticion HTTP que dura minuto y medio no sobrevive al
      `proxy_read_timeout` de nginx, que por defecto son 60: el asesor veria un
      error de una llamada que se cobro y que salio bien. El panel sondea la
      fila hasta que deja de estar PROCESANDO.

      El `void` es deliberado y `ejecutar` no puede lanzar: una promesa
      rechazada sin nadie escuchando tumba el proceso en Node.
    */
    void this.ejecutar(fila.id, image, prompt);

    return fila;
  }

  /**
   * La parte lenta, ya sin nadie esperando al otro lado.
   *
   * No lanza NUNCA. Todo lo que pueda salir mal termina escrito en la fila,
   * porque a partir de la llamada al proveedor el dinero ya esta gastado y un
   * fallo que no deja rastro es un gasto invisible.
   */
  private async ejecutar(
    retouchId: string,
    image: PropertyImage,
    prompt: string,
  ): Promise<void> {
    const { model, quality, timeoutMs } = this.config.retouch;

    const marcarFallido = async (
      motivo: string,
      coste = 0,
      usage = null as {
        inputImageTokens: number;
        inputTextTokens: number;
        outputTokens: number;
      } | null,
    ) => {
      await this.retouches.update(retouchId, {
        status: RetouchStatus.FALLIDO,
        error: motivo,
        costUsd: coste.toFixed(5),
        inputTokens:
          (usage?.inputImageTokens ?? 0) + (usage?.inputTextTokens ?? 0),
        outputTokens: usage?.outputTokens ?? 0,
      });
    };

    let original: Buffer;
    try {
      original = await this.leerOriginal(image);
    } catch (error) {
      await marcarFallido(mensajeDe(error));
      return;
    }

    const fila = await this.retouches.findOne({ where: { id: retouchId } });
    if (!fila) return;

    // El corte por tiempo es generoso a proposito: cortar una edicion a medias
    // la paga igual y no deja nada. Ver `RETOUCH_TIMEOUT_MS`.
    const abort = new AbortController();
    const temporizador = setTimeout(() => abort.abort(), timeoutMs);

    let editada: Awaited<ReturnType<OpenAiProvider['editImage']>>;
    try {
      editada = await this.provider.editImage({
        model,
        image: original,
        mimeType: 'image/webp',
        prompt,
        size: fila.size,
        quality,
        signal: abort.signal,
      });
    } catch (error) {
      await marcarFallido(mensajeDe(error));
      return;
    } finally {
      clearTimeout(temporizador);
    }

    const costeUsd = this.calcularCoste(editada.usage);

    try {
      /*
        Se reencodean los pixeles antes de entregarlos al almacen, y hay que
        explicar por que: el PNG que devuelve OpenAI trae un manifiesto de
        procedencia C2PA en los primeros bytes, y dentro de ese manifiesto viene
        la cadena `<svg`. `FileSecurityService` la lee y rechaza el fichero
        entero por poliglota —un fichero valido como imagen y como marcado a la
        vez—, que es justo lo que esa comprobacion tiene que hacer con bytes que
        vienen de fuera.

        La tentacion es aflojar la comprobacion para este caso. Seria un error:
        esos bytes son de un tercero y la regla existe precisamente para ellos.
        Lo que se hace es lo contrario — quedarse solo con los pixeles y tirar
        todos los metadatos, que es lo que `sharp` hace por defecto. Se gana
        ademas quitar de encima una superficie de ataque que no necesitamos.

        Consecuencia asumida: la firma C2PA se pierde. Se perderia igual mas
        adelante, porque el almacen reencodea a WebP en cuatro tamaños. Por eso
        la procedencia de estas imagenes vive en `image_retouch` y no dentro del
        fichero: en el fichero no hay sitio donde sobreviva.
      */
      const soloPixeles = await sharp(editada.data).png().toBuffer();

      /*
        `revelar: false`, y es importante.

        `StorageService` revela por defecto toda foto que entra, y lo que se le
        entrega aqui YA viene revelado dos veces: una por el revelado automatico
        que se aplico cuando la foto se subio —lo que se le manda al modelo es
        el archivo publicado, no el negativo— y otra por el propio modelo, que
        decide su tono al redibujar la imagen. Dejar que lo revele una tercera
        vez es estirar los niveles de una foto a la que ya se le estiraron: se
        pierde justo lo que se acaba de pagar por mejorar.

        Con `revelar: false` las cuatro variantes salen identicas al negativo, y
        el negativo es lo que devolvio el modelo. Una sola pasada de tono.
      */
      const guardada = await this.storage.saveImage(
        soloPixeles,
        StorageService.directoryOf(image.storageKey),
        'retoque.png',
        { revelar: false },
      );

      await this.retouches.update(retouchId, {
        model: editada.model,
        costUsd: costeUsd.toFixed(5),
        inputTokens:
          (editada.usage?.inputImageTokens ?? 0) +
          (editada.usage?.inputTextTokens ?? 0),
        outputTokens: editada.usage?.outputTokens ?? 0,
        retouchedSnapshot: {
          storageKey: guardada.key,
          url: guardada.url,
          urlMedium: guardada.urlMedium,
          urlLarge: guardada.urlLarge,
          urlOriginal: guardada.urlOriginal,
          width: guardada.width,
          height: guardada.height,
          bytes: guardada.bytes,
          checksum: guardada.checksum,
          urlRaw: guardada.urlRaw,
          urlRawLarge: guardada.urlRawLarge,
          /*
            Sin revelar y sin plan de revelado, que es la verdad: estos pixeles
            los decidio el modelo, no la recta de niveles. Escribir aqui el
            revelado de la foto anterior haria que la fila atribuyera al
            programa un tono que no puso.
          */
          developedAt: null,
          develop: null,
        },
        // Listo, pero la foto del anuncio sigue siendo la de antes.
        status: RetouchStatus.PENDIENTE,
        error: null,
      });
    } catch (error) {
      // El coste se guarda aunque no haya imagen: se pago igual.
      await marcarFallido(
        `El proveedor devolvio la imagen pero no se pudo guardar: ${mensajeDe(error)}`,
        costeUsd,
        editada.usage,
      );
      this.logger.error(
        `Retoque pagado y perdido en la imagen ${image.id}: ${mensajeDe(error)}`,
      );
    }
  }

  /**
   * El asesor lo mira y dice que si: la foto del anuncio pasa a ser la retocada.
   *
   * Lo unico que cambia en `property_image` son las urls y la marca. Los
   * ficheros del original NO se borran: siguen en `uploads/` y siguen nombrados
   * por `originalSnapshot`, que es lo que hace que volver atras sea posible
   * siempre y no solo "mientras no se haya limpiado nada".
   */
  async aplicar(id: string, actor: AuthenticatedActor): Promise<ImageRetouch> {
    const retoque = await this.cargarRetoque(id, actor);

    if (retoque.status === RetouchStatus.PROCESANDO) {
      throw new BadRequestException(
        'Este retoque todavia se esta generando: no hay nada que aceptar',
      );
    }
    if (retoque.status !== RetouchStatus.PENDIENTE) {
      throw new BadRequestException(
        `Este retoque ya esta ${retoque.status.toLowerCase()}`,
      );
    }
    if (!retoque.retouchedSnapshot) {
      throw new BadRequestException('Este retoque no tiene imagen que aplicar');
    }

    const nueva = retoque.retouchedSnapshot;
    await this.images.update(retoque.propertyImageId, {
      storageKey: nueva.storageKey,
      url: nueva.url,
      urlMedium: nueva.urlMedium,
      urlLarge: nueva.urlLarge,
      urlOriginal: nueva.urlOriginal,
      width: nueva.width,
      height: nueva.height,
      bytes: nueva.bytes,
      checksum: nueva.checksum,
      /*
        Las urls del "sin revelar" apuntan ahora a las del retoque. Si se
        quedaran las viejas, el comparador del panel enseñaria al lado de la
        foto nueva el antes de la foto que acaba de dejar de publicarse.
      */
      urlRaw: nueva.urlRaw,
      urlRawLarge: nueva.urlRawLarge,
      developedAt: nueva.developedAt,
      develop: nueva.develop,
      /*
        La marca. Mientras esta columna apunte a esta fila, esa foto del
        catalogo no es una fotografia: es lo que un modelo dibujo a partir de
        una. Es la unica respuesta que quedara dentro de seis meses.
      */
      retouchId: retoque.id,
      retouchedAt: new Date(),
      /*
        La huella perceptual se invalida a proposito. La calculo la subida sobre
        los pixeles de antes, y estos son otros: dejarla puesta haria que el
        detector de repetidas comparase la foto nueva con la huella de la vieja
        y contestara que no. Nula es honesto — se recalcula cuando se toque.
      */
      perceptualHash: null,
    });

    retoque.status = RetouchStatus.APLICADO;
    retoque.decidedByAgentId = actor.id;
    retoque.decidedAt = new Date();
    return this.retouches.save(retoque);
  }

  /**
   * El asesor lo mira y dice que no.
   *
   * Aqui SI se borran ficheros, y son los del candidato: no los nombra nadie,
   * nunca se publicaron y son cuatro webp por intento sobre un disco que ya
   * lleva 4,5 GB. La fila se queda, con lo que se pidio y lo que costo.
   */
  async descartar(
    id: string,
    actor: AuthenticatedActor,
  ): Promise<ImageRetouch> {
    const retoque = await this.cargarRetoque(id, actor);

    if (retoque.status === RetouchStatus.APLICADO) {
      throw new BadRequestException(
        'Este retoque esta aplicado. Para deshacerlo hay que revertirlo, no descartarlo.',
      );
    }
    if (retoque.status === RetouchStatus.DESCARTADO) return retoque;

    if (retoque.retouchedSnapshot) {
      await this.storage.remove(retoque.retouchedSnapshot.storageKey);
      retoque.retouchedSnapshot = null;
    }
    retoque.status = RetouchStatus.DESCARTADO;
    retoque.decidedByAgentId = actor.id;
    retoque.decidedAt = new Date();
    return this.retouches.save(retoque);
  }

  /**
   * Volver a la foto de verdad.
   *
   * Es la operacion que justifica que `originalSnapshot` sea una copia y no una
   * referencia. Y no se cobra: los ficheros ya estaban ahi.
   */
  async revertir(id: string, actor: AuthenticatedActor): Promise<ImageRetouch> {
    const retoque = await this.cargarRetoque(id, actor);

    if (retoque.status !== RetouchStatus.APLICADO) {
      throw new BadRequestException(
        'Solo se puede revertir un retoque que este aplicado',
      );
    }

    const previa = retoque.originalSnapshot;
    /*
      Si los ficheros del original ya no estan —un borrado manual, una
      restauracion a medias— es mejor decirlo que dejar la ficha apuntando a
      una url que da 404. Una foto rota en el anuncio es peor que una retocada.
    */
    if (!(await this.storage.fileExists(previa.storageKey))) {
      throw new BadRequestException(
        'No se puede revertir: el fichero original ya no esta en el almacen',
      );
    }

    await this.images.update(retoque.propertyImageId, {
      storageKey: previa.storageKey,
      url: previa.url,
      urlMedium: previa.urlMedium,
      urlLarge: previa.urlLarge,
      urlOriginal: previa.urlOriginal,
      width: previa.width,
      height: previa.height,
      bytes: previa.bytes,
      checksum: previa.checksum,
      // La fila entera vuelve a como estaba, revelado incluido.
      urlRaw: previa.urlRaw,
      urlRawLarge: previa.urlRawLarge,
      developedAt: previa.developedAt,
      develop: previa.develop,
      // Vuelve a ser una fotografia: se quita la marca.
      retouchId: null,
      retouchedAt: null,
      perceptualHash: null,
    });

    retoque.status = RetouchStatus.REVERTIDO;
    retoque.decidedByAgentId = actor.id;
    retoque.decidedAt = new Date();
    return this.retouches.save(retoque);
  }

  /**
   * Lo que lleva gastado un inmueble en retoques, y cuantas de sus fotos han
   * dejado de ser fotos.
   *
   * Las dos cifras juntas porque es la conversacion que hay que poder tener:
   * "este inmueble tiene ocho fotos retocadas y ha costado 1,45 dolares".
   */
  async resumenPorInmueble(propertyId: string, actor: AuthenticatedActor) {
    await this.cargarInmueble(propertyId, actor);

    const filas = await this.retouches.find({ where: { propertyId } });
    const aplicados = filas.filter((f) => f.status === RetouchStatus.APLICADO);
    return {
      intentos: filas.length,
      aplicados: aplicados.length,
      // Se suma TODO lo intentado, no solo lo aplicado: un descarte tambien se
      // pago, y una cuenta de gasto que solo mira los aciertos miente.
      costeTotalUsd: filas
        .reduce((total, fila) => total + Number(fila.costUsd), 0)
        .toFixed(4),
      alteranLaRealidad: aplicados.filter(
        (f) => f.kind !== RetouchKind.REVELADO,
      ).length,
    };
  }

  // --- interior -------------------------------------------------------------

  /**
   * El coste real de la llamada, de los tokens que devolvio el proveedor.
   *
   * De los tokens y no de una tabla de "cuesta X por foto": el precio por
   * imagen depende del tamaño y de la calidad, y una tabla nuestra se quedaria
   * vieja en silencio. Los tokens los dice quien cobra.
   */
  private calcularCoste(
    usage: {
      inputImageTokens: number;
      inputTextTokens: number;
      outputTokens: number;
    } | null,
  ): number {
    if (!usage) return 0;
    const porMillon = (tokens: number, precio: number) =>
      (tokens / 1_000_000) * precio;
    return (
      porMillon(usage.inputImageTokens, PRECIO_USD_POR_MILLON.imagenEntrada) +
      porMillon(usage.inputTextTokens, PRECIO_USD_POR_MILLON.textoEntrada) +
      porMillon(usage.outputTokens, PRECIO_USD_POR_MILLON.salida)
    );
  }

  /**
   * El tamaño de salida que el proveedor acepta y que menos deforma la foto.
   *
   * `gpt-image-2` solo admite lados multiplos de 16, y las fotos del catalogo
   * son de 1600x1067: ninguno de los dos lados vale. Se redondea cada lado al
   * multiplo de 16 mas cercano conservando la proporcion lo mejor posible, y
   * se acota a los limites del modelo.
   *
   * Sin esto el proveedor contesta 400 y la pulsacion no cuesta nada pero
   * tampoco hace nada, que desde el panel se ve igual que una averia.
   */
  private tamanoSalida(ancho: number | null, alto: number | null): string {
    // Sin medidas guardadas se cae a un cuadrado admitido: es mejor un retoque
    // con la proporcion cambiada que ninguno, y el asesor lo va a ver antes de
    // aceptarlo.
    if (!ancho || !alto) return '1024x1024';

    let w = ancho;
    let h = alto;

    // Proporcion: el modelo no pasa de 3:1 en ninguno de los dos sentidos.
    const proporcion = w / h;
    if (proporcion > 3) w = h * 3;
    if (proporcion < 1 / 3) h = w * 3;

    // Lado mayor dentro del techo.
    const mayor = Math.max(w, h);
    if (mayor > LADO_MAXIMO) {
      const factor = LADO_MAXIMO / mayor;
      w *= factor;
      h *= factor;
    }

    // Area dentro de la horquilla. Se escala por la raiz porque el limite es de
    // pixeles totales, no de lado.
    const area = w * h;
    if (area < PIXELES_MINIMOS) {
      const factor = Math.sqrt(PIXELES_MINIMOS / area);
      w *= factor;
      h *= factor;
    } else if (area > PIXELES_MAXIMOS) {
      const factor = Math.sqrt(PIXELES_MAXIMOS / area);
      w *= factor;
      h *= factor;
    }

    // Al multiplo de 16, hacia arriba: redondear hacia abajo puede volver a
    // caer por debajo del minimo de pixeles que se acaba de arreglar.
    const cuadrar = (valor: number) =>
      Math.max(
        LADO_MULTIPLO,
        Math.min(LADO_MAXIMO, Math.ceil(valor / LADO_MULTIPLO) * LADO_MULTIPLO),
      );

    return `${cuadrar(w)}x${cuadrar(h)}`;
  }

  /** Copia de como esta la foto ahora mismo, para poder volver. */
  private instantanea(image: PropertyImage): InstantaneaImagen {
    return {
      storageKey: image.storageKey,
      url: image.url,
      urlMedium: image.urlMedium,
      urlLarge: image.urlLarge,
      urlOriginal: image.urlOriginal,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      checksum: image.checksum,
      // El estado del revelado va dentro: ver `InstantaneaImagen`.
      urlRaw: image.urlRaw,
      urlRawLarge: image.urlRawLarge,
      developedAt: image.developedAt,
      develop: image.develop,
    };
  }

  /**
   * Lee del disco la foto que se esta publicando, en su tamaño de archivo.
   *
   * El archivo publicado y NO el negativo `-r.webp`. Es deliberado: lo que el
   * asesor quiere mejorar es la foto que se ve en el anuncio, que ya viene
   * revelada, y partir del negativo tiraria a la basura ese revelado para que
   * el modelo lo rehiciera a su manera. Como contrapartida, lo que se guarda
   * despues NO se vuelve a revelar — ver `revelar: false` mas arriba.
   */
  private async leerOriginal(image: PropertyImage): Promise<Buffer> {
    const clave = image.storageKey.replace(/-o\.webp$/, VARIANTE_ORIGEN);
    try {
      return await readFile(join(this.storage.root, clave));
    } catch {
      throw new BadRequestException(
        'El fichero de esta foto no esta en el almacen: no se puede retocar',
      );
    }
  }

  /**
   * Carga la foto comprobando que quien pregunta puede verla — y, si va a
   * escribir, que puede tocar ese inmueble.
   *
   * El permiso se mira sobre el INMUEBLE y no sobre la foto: una foto no tiene
   * asesor asignado ni sede, las hereda de la ficha a la que cuelga.
   */
  private async cargarImagen(
    imageId: string,
    actor: AuthenticatedActor,
    { paraEscribir = false } = {},
  ): Promise<{ image: PropertyImage; property: Property }> {
    const image = await this.images.findOne({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Foto no encontrada');
    const property = await this.cargarInmueble(image.propertyId, actor, {
      paraEscribir,
    });
    return { image, property };
  }

  private async cargarInmueble(
    propertyId: string,
    actor: AuthenticatedActor,
    { paraEscribir = false } = {},
  ): Promise<Property> {
    const property = await this.properties.findOne({
      where: { id: propertyId },
    });
    if (!property) throw new NotFoundException('Inmueble no encontrado');
    assertSameBranch(actor, property.branchId);
    if (paraEscribir) {
      assertCanMutate(actor, property.assignedAgentId, 'este inmueble');
    }
    return property;
  }

  private async cargarRetoque(
    id: string,
    actor: AuthenticatedActor,
  ): Promise<ImageRetouch> {
    const retoque = await this.retouches.findOne({ where: { id } });
    if (!retoque) throw new NotFoundException('Retoque no encontrado');
    await this.cargarInmueble(retoque.propertyId, actor, {
      paraEscribir: true,
    });
    return retoque;
  }
}

/** El texto de un error, venga como venga. */
function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
