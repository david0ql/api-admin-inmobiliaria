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
  constructor(private readonly storage: StorageService) {}

  /**
   * Guarda los ficheros y los cuelga de la galeria.
   *
   * Las que fallen se reportan sin tumbar el resto del lote: en una subida de
   * treinta fotos, una con los metadatos rotos no puede perder las otras
   * veintinueve.
   */
  async add<T extends ImageAsset>(
    coleccion: Coleccion<T>,
    files: Express.Multer.File[],
    kind: ImageKind = ImageKind.PHOTO,
  ): Promise<{ images: T[]; rejected: ImagenRechazada[] }> {
    const { repo, owner, scope } = coleccion;
    if (!files?.length) {
      throw new BadRequestException(
        'No llego ningun archivo en el campo `files`',
      );
    }

    const existing = await repo.count({ where: owner });
    const saved: T[] = [];
    const rejected: ImagenRechazada[] = [];

    for (const file of files) {
      try {
        const stored = await this.storage.saveImage(
          file.buffer,
          scope,
          file.originalname,
        );
        saved.push(
          await repo.save(
            repo.create({
              ...owner,
              storageKey: stored.key,
              url: stored.url,
              urlMedium: stored.urlMedium,
              urlLarge: stored.urlLarge,
              urlOriginal: stored.urlOriginal,
              checksum: stored.checksum,
              width: stored.width,
              height: stored.height,
              bytes: stored.bytes,
              description: null,
              kind,
              position: existing + saved.length + 1,
              // La primera imagen de la galeria se convierte en portada.
              isMain: existing === 0 && saved.length === 0,
            } as DeepPartial<T>),
          ),
        );
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
      throw new BadRequestException(
        `Ninguna imagen se pudo guardar. ${rejected
          .map((r) => `${r.name}: ${r.reason}`)
          .join('; ')}`,
      );
    }

    return { images: saved, rejected };
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
