import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeepPartial,
  EntityTarget,
  FindOptionsOrder,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { ImageAsset, ImageKind } from './image-asset.entity';
import { StorageService } from './storage.service';
import { ImageGateService } from './image-gate.service';
import { ImageDevelopService } from './image-develop.service';
import { GateProfile, GateSeverity, type GateIssue } from './image-gate.rules';

/**
 * El orden de la galeria, siempre el mismo.
 *
 * `FindOptionsOrder` sobre un generico no acepta la columna heredada sin
 * ayuda, y el molde se escribe una vez aqui en lugar de repartir una
 * conversion en cada consulta.
 */
function orden<T extends ImageAsset>(): FindOptionsOrder<T> {
  return { position: 'ASC' } as FindOptionsOrder<T>;
}

/** Lo que no se pudo guardar, con el motivo, para poder decirlo en pantalla. */
export interface ImagenRechazada {
  name: string;
  reason: string;
}

/**
 * Lo que entro pero tiene algo que mirar.
 *
 * Separado de `rejected` porque son dos cosas distintas y confundirlas se paga
 * de las dos maneras: una foto buena marcada como rechazada hace que el asesor
 * la vuelva a subir, y una foto con un defecto real escondida entre los aciertos
 * acaba publicada. Aqui esta lo que entro y conviene revisar.
 */
export interface ImagenConAviso {
  name: string;
  issues: GateIssue[];
}

/** El dueño de la galeria, tal y como se pregunta y se escribe. */
export interface Coleccion<T extends ImageAsset> {
  repo: Repository<T>;
  /** La condicion que identifica la galeria: `{ familyId: id }`. */
  owner: FindOptionsWhere<T>;
  /** Carpeta bajo `uploads/`: borrar el dueño es borrar la carpeta. */
  scope: string;
  /** Como se nombra en los mensajes de error: "este proyecto". */
  que: string;
}

/**
 * Subir, ordenar, elegir portada y borrar imagenes de cualquier cosa.
 *
 * Las tres galerias del sistema —inmueble, proyecto, tipologia— viven en tres
 * tablas distintas porque cada una quiere su clave ajena de verdad (ver
 * `ImageAsset`), pero hacen exactamente lo mismo con ellas. Tenerlo escrito
 * tres veces es garantizar que dentro de un mes la del proyecto promueva la
 * siguiente portada al borrar y la de la tipologia deje la ficha sin foto, sin
 * que nadie sepa por que.
 *
 * Lo que NO hace este servicio es decidir quien puede: los permisos y el
 * acotado por sede se comprueban antes, en el servicio que conoce al dueño.
 * Aqui se recibe una galeria que ya se sabe alcanzable.
 */
@Injectable()
export class ImageCollectionService {
  constructor(
    private readonly storage: StorageService,
    private readonly gate: ImageGateService,
    private readonly develop: ImageDevelopService,
  ) {}

  /**
   * Guarda los ficheros y los cuelga de la galeria.
   *
   * Las que fallen se reportan sin tumbar el resto del lote: en una subida de
   * treinta fotos, una con los metadatos rotos no puede perder las otras
   * veintinueve.
   *
   * `profile` decide con que liston se mide. `INVENTORY` es lo que sube el
   * equipo y exige calidad de anuncio —horizontal, 1024 px de ancho—; `REQUEST`
   * es lo que manda un propietario desde el movil y solo bloquea lo que no se
   * puede ver, porque ahi un rechazo no mejora una foto: cierra el formulario y
   * pierde el cliente.
   */
  async add<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    files: Express.Multer.File[],
    kind: ImageKind = ImageKind.PHOTO,
    profile: GateProfile = GateProfile.INVENTORY,
  ): Promise<{
    images: T[];
    rejected: ImagenRechazada[];
    warnings: ImagenConAviso[];
  }> {
    const { repo, owner, scope } = coleccion;
    if (!files?.length) {
      throw new BadRequestException(
        'No llego ningun archivo en el campo `files`',
      );
    }

    /*
      Las huellas de lo que ya cuelga de esta galeria, leidas UNA vez.

      Sirven para no repetir foto. Se traen enteras y no una consulta por
      archivo porque una subida son treinta ficheros contra la misma lista, y
      una galeria no pasa de unas decenas de imagenes.
    */
    const previas = (await repo.find({
      where: owner,
      select: { checksum: true, perceptualHash: true } as never,
    })) as Pick<ImageAsset, 'checksum' | 'perceptualHash'>[];

    const saved: T[] = [];
    const rejected: ImagenRechazada[] = [];
    const warnings: ImagenConAviso[] = [];
    const huellas = [...previas];

    for (const file of files) {
      try {
        /*
          La puerta de calidad va ANTES de guardar nada.

          No es solo cuestion de criterio: recomprimir una foto a cuatro
          tamanos WebP es lo mas caro que hace esta API, y pagarlo por una
          imagen de 500x500 que se iba a rechazar igual es tirar CPU. Medirla
          cuesta milisegundos.
        */
        const veredicto = await this.gate.evaluate(
          file.buffer,
          file.originalname,
          profile,
          huellas,
          // `que` ya lo sabe la coleccion: "este inmueble", "este proyecto",
          // "esta tipologia". El gate no tiene por que adivinarlo.
          coleccion.que,
        );
        if (!veredicto.accepted) {
          rejected.push({
            name: file.originalname,
            reason: veredicto.issues
              .filter((i) => i.severity === GateSeverity.BLOCK)
              .map((i) => i.message)
              .join(' '),
          });
          continue;
        }
        const avisos = veredicto.issues.filter(
          (i) => i.severity === GateSeverity.WARN,
        );
        if (avisos.length) {
          warnings.push({ name: file.originalname, issues: avisos });
        }
        // Se apunta la huella ya, no al final: dos copias de la misma foto
        // dentro del MISMO lote tienen que detectarse una contra otra.
        huellas.push({
          checksum: veredicto.metrics.checksum,
          perceptualHash: veredicto.metrics.perceptualHash,
        });

        /*
          El revelado va aqui dentro, no como paso aparte.

          Se le pasan las metricas que la puerta acaba de medir para no volver
          a decodificar la foto entera, y sobre todo para que las dos cosas
          opinen lo mismo: la foto que el asesor ve avisada como "oscura" es
          exactamente la que el revelado va a levantar.
        */
        const stored = await this.storage.saveImage(
          file.buffer,
          scope,
          file.originalname,
          { metrics: veredicto.metrics },
        );

        /*
          A partir de aqui hay cuatro ficheros en disco que solo la fila los
          nombra. Si el INSERT falla —la galeria se borro mientras subia, la
          base se cayo— y no se deshace, quedan cuatro huerfanos que nadie
          volvera a mirar ni a poder borrar, porque no hay ningun registro
          desde el que llegar a ellos. Se ha visto pasar: en `uploads/` hay
          ficheros de una importacion interrumpida que no estan en la base.
        */
        try {
          saved.push(
            await this.insertarAlFinal(coleccion, {
              ...owner,
              storageKey: stored.key,
              url: stored.url,
              urlMedium: stored.urlMedium,
              urlLarge: stored.urlLarge,
              urlOriginal: stored.urlOriginal,
              checksum: stored.checksum,
              perceptualHash: veredicto.metrics.perceptualHash,
              // Revelada de salida: se apunta cuando, y con que, aunque el
              // revelado haya sido "no hacia falta nada" (`develop` nulo).
              developedAt: new Date(),
              develop: stored.revelado,
              urlRaw: stored.urlRaw,
              urlRawLarge: stored.urlRawLarge,
              width: stored.width,
              height: stored.height,
              bytes: stored.bytes,
              description: null,
              kind,
            } as DeepPartial<T>),
          );
        } catch (error) {
          await this.storage.remove(stored.key);
          throw error;
        }
      } catch (error) {
        rejected.push({
          name: file.originalname,
          reason:
            error instanceof Error
              ? error.message
              : 'Error al procesar la imagen',
        });
      }
    }

    if (!saved.length) {
      /*
        El cuerpo lleva el desglose ademas del texto.

        Es un 400 porque la peticion no consiguio nada, y eso el cliente tiene
        que poder tratarlo como un fallo. Pero el motivo de CADA fichero es lo
        que el asesor necesita leer —"esta esta vertical", "esta ya la subiste"—
        y componerlo en una frase obligaba al panel a deshacerla con una
        expresion regular para volver a separarlo. `message` se conserva tal y
        como estaba para no romper a quien ya lo lee.
      */
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `Ninguna imagen se pudo guardar. ${rejected
          .map((r) => `${r.name}: ${r.reason}`)
          .join('; ')}`,
        rejected,
        warnings,
      });
    }

    return { images: saved, rejected, warnings };
  }

  /**
   * Inserta la imagen al final de la galeria, sin carreras.
   *
   * La posicion se leia contando al empezar el lote y sumando: con dos
   * peticiones en vuelo sobre la misma galeria —que es lo que pasa en cuanto
   * el panel sube dos fotos a la vez— las dos leian el mismo total y las dos
   * escribian la misma posicion, y lo mismo con `isMain`: dos portadas. El
   * panel se defendia subiendo de una en una, o sea pagando la latencia de la
   * oficina foto a foto.
   *
   * El cerrojo es de Postgres y por galeria —la clave es su carpeta, que es su
   * identidad— y dura lo que la transaccion: dos subidas a proyectos distintos
   * no se esperan, y dos al mismo se turnan durante el milisegundo que cuesta
   * contar y meter una fila. No vale un UNIQUE sobre (dueño, position) porque
   * eso no reparte numeros: solo hace fallar a la segunda.
   */
  private async insertarAlFinal<T extends ImageAsset>(
    { repo, owner, scope }: Coleccion<T>,
    campos: DeepPartial<T>,
  ): Promise<T> {
    return repo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        scope,
      ]);

      const tabla = manager.getRepository<T>(repo.target);
      const fila = await tabla
        .createQueryBuilder('imagen')
        .select('COALESCE(MAX(imagen.position), 0)', 'ultima')
        .addSelect('COUNT(*)', 'total')
        .where(owner)
        .getRawOne<{ ultima: string; total: string }>();

      return tabla.save(
        tabla.create({
          ...campos,
          position: Number(fila?.ultima ?? 0) + 1,
          // La primera imagen de la galeria se convierte en portada.
          isMain: Number(fila?.total ?? 0) === 0,
        } as DeepPartial<T>),
      );
    });
  }

  /**
   * Reordena la galeria entera.
   *
   * Se exige la lista completa y no un "mueve esta al hueco 3": el cliente
   * arrastra miniaturas y sabe el orden final, y aceptar movimientos sueltos
   * obligaria a resolver dos arrastres simultaneos sobre posiciones que ya
   * cambiaron.
   */
  async reorder<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    imageIds: string[],
  ): Promise<T[]> {
    const { repo, owner, que } = coleccion;
    const images = await repo.find({ where: owner });
    const known = new Set(images.map((i) => i.id));
    if (
      imageIds.length !== images.length ||
      imageIds.some((id) => !known.has(id))
    ) {
      throw new BadRequestException(
        `El orden debe incluir exactamente las imagenes actuales de ${que}`,
      );
    }

    /*
      La tabla concreta se maneja como `ImageAsset` a proposito: es la clase
      que declara `position` e `isMain`, y sin ella el generico no sabe que la
      entidad tiene esas columnas.
    */
    const tabla: EntityTarget<ImageAsset> = repo.target;
    await repo.manager.transaction(async (manager) => {
      for (const [index, id] of imageIds.entries()) {
        await manager.update(tabla, { id }, { position: index + 1 });
      }
    });

    return repo.find({
      where: owner,
      order: orden<T>(),
    });
  }

  async setMain<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    imageId: string,
  ): Promise<void> {
    const { repo, owner } = coleccion;
    await this.propia(coleccion, imageId);

    const tabla: EntityTarget<ImageAsset> = repo.target;
    await repo.manager.transaction(async (manager) => {
      await manager.update(tabla, owner, {
        isMain: false,
      });
      await manager.update(tabla, { id: imageId }, { isMain: true });
    });
  }

  /**
   * Vuelve a revelar una foto, o le quita el revelado.
   *
   * Es el deshacer que exige tener esto encendido por defecto sobre fotos de
   * clientes reales. Con `aplicar` en false las cuatro variantes se regeneran
   * desde el negativo tal cual salio de la camara; con true se vuelve a
   * revelar con el criterio de hoy, que es lo que hace falta cuando cambian
   * los limites.
   *
   * No se toca `storageKey`: las claves y el negativo siguen donde estaban y
   * lo unico que cambia son los pixeles de las variantes y la marca de version
   * de las URL, sin la cual el navegador seguiria enseniando la foto anterior
   * durante un anio.
   */
  async revelar<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    imageId: string,
    aplicar: boolean,
  ): Promise<T> {
    const imagen = await this.propia(coleccion, imageId);
    const { revelado, bytes, urlRaw, urlRawLarge } =
      await this.storage.rerevelar(imagen.storageKey, (analisis) =>
        aplicar ? this.develop.plan(analisis) : null,
      );

    imagen.developedAt = new Date();
    imagen.develop = revelado;
    imagen.bytes = bytes;
    // El "antes" no se reversiona: sale del negativo, que no cambia nunca.
    imagen.urlRaw = urlRaw;
    imagen.urlRawLarge = urlRawLarge;
    imagen.url = StorageService.marcarVersion(imagen.url);
    if (imagen.urlMedium) {
      imagen.urlMedium = StorageService.marcarVersion(imagen.urlMedium);
    }
    imagen.urlLarge = StorageService.marcarVersion(imagen.urlLarge);
    imagen.urlOriginal = StorageService.marcarVersion(imagen.urlOriginal);
    return coleccion.repo.save(imagen);
  }

  /** El pie de foto y si es foto o plano: lo unico editable de una imagen. */
  async update<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    imageId: string,
    cambios: { description?: string | null; kind?: ImageKind },
  ): Promise<T> {
    const imagen = await this.propia(coleccion, imageId);
    if (cambios.description !== undefined) {
      imagen.description = cambios.description;
    }
    if (cambios.kind !== undefined) imagen.kind = cambios.kind;
    return coleccion.repo.save(imagen);
  }

  /**
   * Borra la imagen y sus cuatro ficheros.
   *
   * El registro y el fichero se van juntos: sin esto `uploads/` crece con
   * huerfanos que nadie vuelve a mirar.
   */
  async remove<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    imageId: string,
  ): Promise<void> {
    const { repo, owner } = coleccion;
    const imagen = await this.propia(coleccion, imageId);

    await repo.delete(imageId);
    await this.storage.remove(imagen.storageKey);

    if (imagen.isMain) {
      // Sin portada la ficha se ve rota: se promueve la siguiente por posicion.
      const siguiente = await repo.findOne({
        where: owner,
        order: orden<T>(),
      });
      if (siguiente) {
        const tabla: EntityTarget<ImageAsset> = repo.target;
        await repo.manager.update(
          tabla,
          { id: siguiente.id },
          { isMain: true },
        );
      }
    }
  }

  /**
   * Borra la galeria entera y su carpeta en disco.
   *
   * Para cuando desaparece el dueño de verdad —una tipologia se borra a
   * secas—: el `ON DELETE CASCADE` se lleva las filas, pero los ficheros
   * seguirian ocupando disco sin que quede ninguna fila que los nombre.
   */
  async removeAll<T extends ImageAsset>(
    coleccion: Coleccion<T>,
  ): Promise<void> {
    await coleccion.repo.delete(coleccion.owner);
    await this.storage.removeScope(coleccion.scope);
  }

  /** La imagen, si de verdad es de esta galeria. */
  private async propia<T extends ImageAsset>(
    { repo, owner, que }: Coleccion<T>,
    imageId: string,
  ): Promise<T> {
    const imagen = await repo.findOne({
      where: { ...owner, id: imageId },
    });
    if (!imagen) {
      throw new NotFoundException(`La imagen no pertenece a ${que}`);
    }
    return imagen;
  }
}
