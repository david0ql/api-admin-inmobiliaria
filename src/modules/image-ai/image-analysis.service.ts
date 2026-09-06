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
import { OpenAiProvider } from '../assistant/openai-provider';
import type { VisionImage } from '../assistant/vision-provider';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { assertCanMutate, assertSameBranch } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ImageAnalysis } from './domain/image-analysis.entity';
import { ImageAlbumAnalysis } from './domain/image-album-analysis.entity';
import { ImagePromptService } from './image-prompt.service';
import { parseAnalysisResponse } from './image-analysis.contract';
import type {
  AlbumJudgement,
  AnalysisResponse,
  ImageJudgement,
} from './image-analysis.contract';

/**
 * Cuantas fotos caben en una llamada.
 *
 * Es un limite de dinero, no de tecnica. Cada imagen se paga, y un asesor que
 * pulse "analizar" en un inmueble con cuarenta fotos no puede lanzar cuarenta
 * cobros de golpe sin haberlo pedido. Veinte cubre el 99 % de los inmuebles del
 * inventario de una sola vez; los pocos que tienen mas se piden en dos tandas,
 * conscientemente.
 */
const MAX_POR_LOTE = 20;

/**
 * Que variante del fichero se le manda al modelo.
 *
 * La de 800 px, no la de 2560. El modelo trocea la imagen en cuadros y cobra
 * por cuadro: mandarle el archivo entero multiplica el precio por seis para
 * reconocer exactamente la misma cocina. A 800 px se distingue una alcoba de un
 * estudio, que es lo que se le pregunta.
 */
const VARIANTE = '-m.webp';

/** Una fila de `image_analysis` a punto de escribirse: solo columnas. */
type FilaAnalisis = Omit<
  ImageAnalysis,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'image'
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
  ) {}

  /** Si hay clave y esta encendido. Lo consulta el controller para dar 503. */
  get available(): boolean {
    return this.config.imageAi.enabled;
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
      };
    }

    const lote = candidatas.slice(0, this.config.imageAi.maxImages);
    if (candidatas.length > lote.length) {
      this.logger.log(
        `Inmueble ${property.code}: ${candidatas.length} fotos pendientes, se analizan ${lote.length} en este lote`,
      );
    }

    const cargadas = await this.cargar(lote);
    if (!cargadas.length) {
      throw new BadRequestException(
        'No se pudo leer ninguno de los archivos de imagen en disco',
      );
    }

    const respuesta = await this.provider.seeJson({
      model,
      system: prompt.body,
      user: this.contexto(property, cargadas),
      images: cargadas.map((c): VisionImage => ({
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

    const batchId = randomUUID();
    const analyzed = await this.guardar(cargadas, parsed.images, {
      batchId,
      promptVersion: prompt.version,
      model: respuesta.model,
      actor,
    });
    const album = parsed.album
      ? await this.guardarAlbum(propertyId, cargadas, parsed.album, {
          batchId,
          promptVersion: prompt.version,
          model: respuesta.model,
          actor,
        })
      : null;

    this.logger.log(
      `Analizadas ${analyzed.length} fotos de ${property.code} (prompt v${prompt.version}, ${respuesta.model}, ${respuesta.usage?.inputTokens ?? '?'} tokens de entrada)`,
    );

    return { batchId, analyzed, skipped, album, usage: respuesta.usage };
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
  private async cargar(
    imagenes: PropertyImage[],
  ): Promise<{ image: PropertyImage; buffer: Buffer }[]> {
    const salida: { image: PropertyImage; buffer: Buffer }[] = [];
    for (const image of imagenes) {
      const key = image.storageKey.replace(/-o\.webp$/, VARIANTE);
      try {
        salida.push({
          image,
          buffer: await readFile(join(this.storage.root, key)),
        });
      } catch {
        // Un fichero que falta no puede tumbar el lote: se analiza el resto y
        // esa foto se queda sin juicio, que es exactamente lo que pasa.
        this.logger.warn(`No esta en disco: ${key}`);
      }
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
    cargadas: { image: PropertyImage; buffer: Buffer }[],
  ): string {
    const ficha = [
      `Inmueble ${property.code}: ${property.title}`,
      property.bedrooms ? `${property.bedrooms} alcobas` : null,
      property.bathrooms ? `${property.bathrooms} banos` : null,
      property.builtArea ? `${property.builtArea} m2 construidos` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const lineas = cargadas.map((c, i) => {
      const { width, height } = c.image;
      const forma =
        width && height
          ? width > height
            ? 'horizontal'
            : width === height
              ? 'cuadrada'
              : 'vertical'
          : 'sin medidas';
      return `  ${i}: ${width ?? '?'}x${height ?? '?'} px (${forma})${
        c.image.isMain ? ' — hoy es la portada' : ''
      }`;
    });

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
   * Guarda un juicio por foto.
   *
   * `upsert` sobre (imagen, version del prompt, modelo): repetir la misma
   * pregunta pisa la respuesta anterior, y preguntar con otro prompt deja una
   * fila nueva. Esa es justo la diferencia que hace posible comparar si un
   * cambio del prompt mejoro o empeoro.
   */
  private async guardar(
    cargadas: { image: PropertyImage; buffer: Buffer }[],
    juicios: ImageJudgement[],
    ctx: {
      batchId: string;
      promptVersion: number;
      model: string;
      actor: AuthenticatedActor;
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

    for (const juicio of juicios) {
      const cargada = cargadas[juicio.index];
      // Un indice que no existe significa que el modelo se invento una foto:
      // se ignora en vez de guardar un juicio sin dueño.
      if (!cargada) continue;

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
        usable: juicio.usable,
        promptVersion: ctx.promptVersion,
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

  /** Guarda el juicio del conjunto, traduciendo indices del lote a ids. */
  private async guardarAlbum(
    propertyId: string,
    cargadas: { image: PropertyImage; buffer: Buffer }[],
    album: AlbumJudgement,
    ctx: {
      batchId: string;
      promptVersion: number;
      model: string;
      actor: AuthenticatedActor;
    },
  ): Promise<ImageAlbumAnalysis> {
    const aId = (i: number) => cargadas[i]?.image.id ?? null;

    // Sin repetidos y sin inventados: el orden que se guarda tiene que poder
    // aplicarse tal cual a la galeria.
    const vistos = new Set<string>();
    const orden: string[] = [];
    for (const i of album.suggestedOrder) {
      const id = aId(i);
      if (id && !vistos.has(id)) {
        vistos.add(id);
        orden.push(id);
      }
    }
    // Lo que el modelo se dejo fuera va al final, en el orden que ya tenia: una
    // sugerencia de orden que pierde fotos no se puede aplicar.
    for (const c of cargadas) {
      if (!vistos.has(c.image.id)) orden.push(c.image.id);
    }

    return this.albums.save(
      this.albums.create({
        propertyId,
        batchId: ctx.batchId,
        suggestedOrder: orden,
        coverImageId: aId(album.coverIndex) ?? orden[0] ?? null,
        missing: album.missing,
        summary: album.summary || null,
        promptVersion: ctx.promptVersion,
        model: ctx.model,
        createdByAgentId: ctx.actor.id,
      }),
    );
  }

  /** El techo por lote, para que el panel lo pueda enseñar antes de pulsar. */
  static get maxPorLote(): number {
    return MAX_POR_LOTE;
  }
}
