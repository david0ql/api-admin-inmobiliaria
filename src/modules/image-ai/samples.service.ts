import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { StorageService } from '../media/storage.service';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import {
  Availability,
  MapPublication,
  PublicationStatus,
} from '../properties/domain/property.enums';
import { resolveBranch } from '../iam/scope';
import { seesAllBranches, Role } from '../iam/domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ImageAnalysis } from './domain/image-analysis.entity';
import { ImageAlbumAnalysis } from './domain/image-album-analysis.entity';

/**
 * El prefijo del codigo de un inmueble de muestra.
 *
 * Va en el codigo, que es lo que se ve en TODAS las pantallas, ademas de la
 * columna `is_sample`. Redundante a proposito: la columna es la que manda para
 * borrar y para no publicar, y el prefijo es para que nadie confunda uno de
 * estos con un inmueble real ni un segundo, sin tener que abrir la ficha.
 */
const PREFIJO = 'DEMO-';

/** Cuantos se pueden crear de una vez. Son de mentira; no hacen falta mas. */
const MAX = 5;

/**
 * El material de las muestras.
 *
 * Fichas plausibles de Bucaramanga, con las cifras que tiene de verdad el
 * inventario, para que las pantallas se vean como se van a ver. Sin fotos: las
 * fotos las sube quien esta probando, que es justo lo que quiere ver
 * funcionando.
 */
const MUESTRAS = [
  {
    title: 'Apartamento en Cabecera, 3 alcobas con balcon',
    address: 'Calle 48 con Carrera 33, Cabecera del Llano',
    bedrooms: 3,
    bathrooms: 2,
    garages: 1,
    builtArea: 96,
    stratum: 5,
    salePrice: 480_000_000,
  },
  {
    title: 'Casa en Floridablanca, patio y zona de ropas',
    address: 'Urbanizacion Altos de Bellavista',
    bedrooms: 4,
    bathrooms: 3,
    garages: 2,
    builtArea: 165,
    stratum: 4,
    salePrice: 620_000_000,
  },
  {
    title: 'Apartaestudio en Sotomayor, para renta',
    address: 'Carrera 29 con Calle 51',
    bedrooms: 1,
    bathrooms: 1,
    garages: 0,
    builtArea: 42,
    stratum: 5,
    salePrice: null,
    rentPrice: 1_900_000,
  },
] as const;

/**
 * Inmuebles de muestra para ver como queda el modulo sin tocar los reales.
 *
 * El usuario los pidio "no publicados, solo para ver como quedaria". Aqui eso
 * significa tres candados, no uno:
 *
 * 1. `publicationStatus` en DRAFT, que es lo que ya usa el resto del sistema
 *    para "no sale a la web".
 * 2. `isSample` en cierto, que es lo que la web publica mira para excluirlos
 *    pase lo que pase con el estado de publicacion. Un borrador se puede
 *    activar por error desde el panel; esta columna no se activa sola.
 * 3. El codigo empieza por DEMO-, para que se distingan a simple vista.
 *
 * Y por eso borrarlos es una sola llamada: `is_sample = true` no lo tiene ni un
 * inmueble real, asi que no hay forma de que este borrado se lleve por delante
 * algo del inventario de verdad.
 */
@Injectable()
export class SamplesService {
  private readonly logger = new Logger(SamplesService.name);

  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(PropertyImage)
    private readonly images: Repository<PropertyImage>,
    @InjectRepository(ImageAnalysis)
    private readonly analyses: Repository<ImageAnalysis>,
    @InjectRepository(ImageAlbumAnalysis)
    private readonly albums: Repository<ImageAlbumAnalysis>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  list(): Promise<Property[]> {
    return this.properties.find({
      where: { isSample: true },
      order: { code: 'ASC' },
    });
  }

  /**
   * Crea las fichas de muestra.
   *
   * Los catalogos (moneda, tipo, ciudad) no se inventan: se cogen de un
   * inmueble real que ya existe. Sembrar ids a mano seria dar por hecho que la
   * base de este despliegue tiene los mismos numeros que la del desarrollo, y
   * el dia que no los tenga esto falla con una violacion de clave ajena que no
   * le dice nada a nadie.
   */
  async create(
    cuantos: number,
    actor: AuthenticatedActor,
  ): Promise<Property[]> {
    if (cuantos < 1 || cuantos > MAX) {
      throw new BadRequestException(
        `Se pueden crear entre 1 y ${MAX} inmuebles de muestra`,
      );
    }

    const referencia = await this.properties.findOne({
      where: { isSample: false },
      order: { createdAt: 'ASC' },
    });
    if (!referencia) {
      throw new BadRequestException(
        'No hay ningun inmueble real del que copiar los catalogos (moneda, tipo, ciudad). Importa el inventario primero.',
      );
    }

    /*
      La sede de las muestras.

      Quien pertenece a una sede crea en la suya, y eso lo impone `resolveBranch`
      igual que en cualquier alta. Pero un administrador con "todas las sedes"
      puesto no tiene ninguna elegida, y `resolveBranch` le exige que escoja
      antes de crear — que para un inmueble de verdad es lo correcto, porque uno
      sin oficina que lo lleve no lo trabaja nadie, y para tres fichas de prueba
      que se van a borrar es un callejon sin salida.

      Asi que en ese unico caso se hereda la sede del inmueble del que ya se
      estan copiando los catalogos. No se relaja nada: quien no ve todas las
      sedes sigue pasando por la comprobacion de siempre.
    */
    const branchId =
      seesAllBranches(actor.role as Role) &&
      !actor.branchId &&
      !RequestContext.branchId()
        ? referencia.branchId
        : resolveBranch(actor, null);
    const existentes = await this.properties.count({
      where: { isSample: true },
    });
    const creados: Property[] = [];

    for (let i = 0; i < cuantos; i++) {
      const plantilla = MUESTRAS[i % MUESTRAS.length];
      const numero = existentes + i + 1;
      creados.push(
        this.properties.create({
          code: `${PREFIJO}${String(numero).padStart(3, '0')}`,
          title: `[MUESTRA] ${plantilla.title}`,
          address: plantilla.address,
          isSample: true,
          // Los tres candados. Ver el comentario de la clase.
          publicationStatus: PublicationStatus.DRAFT,
          availability: Availability.AVAILABLE,
          // Sin mapa: son direcciones inventadas y no tiene sentido plantar un
          // alfiler en una calle real por una ficha de prueba.
          mapPublication: MapPublication.HIDDEN,
          forSale: plantilla.salePrice !== null,
          forRent: 'rentPrice' in plantilla,
          forTransfer: false,
          forTemporaryRent: false,
          salePrice: plantilla.salePrice ?? null,
          rentPrice: 'rentPrice' in plantilla ? plantilla.rentPrice : null,
          currencyId: referencia.currencyId,
          propertyTypeId: referencia.propertyTypeId,
          cityId: referencia.cityId,
          zoneId: referencia.zoneId,
          branchId,
          assignedAgentId: actor.id,
          bedrooms: plantilla.bedrooms,
          bathrooms: plantilla.bathrooms,
          garages: plantilla.garages,
          builtArea: plantilla.builtArea,
          stratum: plantilla.stratum,
          observations:
            'Inmueble de muestra creado para probar el analisis de imagenes. No es real y no sale a la web. Se puede borrar entero desde la misma pantalla.',
        }),
      );
    }

    const guardados = await this.properties.save(creados);
    this.logger.log(
      `Creados ${guardados.length} inmuebles de muestra: ${guardados.map((p) => p.code).join(', ')}`,
    );
    return guardados;
  }

  /**
   * Borra TODOS los de muestra, con sus fotos y sus analisis.
   *
   * Filtra por `is_sample = true` y por nada mas. No acepta una lista de ids
   * desde fuera a proposito: un endpoint de borrado masivo que recibe ids es un
   * endpoint que un dia recibe el id de un inmueble real.
   */
  async removeAll(): Promise<{ properties: number; images: number }> {
    const muestras = await this.properties.find({ where: { isSample: true } });
    if (!muestras.length) return { properties: 0, images: 0 };

    const ids = muestras.map((p) => p.id);
    const fotos = await this.images.find({
      where: ids.map((id) => ({ propertyId: id })),
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(
        ImageAnalysis,
        ids.map((propertyId) => ({ propertyId })),
      );
      await manager.delete(
        ImageAlbumAnalysis,
        ids.map((propertyId) => ({ propertyId })),
      );
      // Borrado de verdad, no logico: una muestra no tiene nada que auditar y
      // dejarla con `deleted_at` la mantendria contando en los conteos crudos.
      await manager.delete(
        PropertyImage,
        ids.map((propertyId) => ({ propertyId })),
      );
      await manager.delete(Property, ids);
    });

    /*
      Los ficheros van despues de la transaccion: si el borrado en base falla,
      lo peor que puede pasar es que sobren unas carpetas, y no que la ficha
      quede apuntando a fotos que ya no existen.

      Y se borra por CARPETA de un inmueble que creo este mismo modulo, nunca
      por `storage_key` ni recorriendo el disco en busca de huerfanos. Es una
      invariante que hay que mantener si alguien amplia esto:

      Un fichero de `uploads/` esta vivo si lo nombra CUALQUIERA de las siete
      columnas que guardan rutas, no solo las cinco de `property_image`: estan
      tambien `property_family.cover_url` y `agent.photo_url`. Y `photo_url`
      guarda unicamente la miniatura `-t`, asi que las variantes `-m`, `-l` y
      `-o` de la foto de un asesor NO aparecen citadas en ninguna parte y sin
      embargo estan en uso. Una limpieza que decida por `storage_key` se las
      lleva, y la foto del asesor se rompe el dia que alguien la pinte a mas de
      560 px. Lo verifico `fotos-api` barriendo las 129 columnas de texto del
      esquema, no de memoria.
    */
    for (const id of ids) {
      await this.storage.removeScope(`properties/${id}`);
    }

    this.logger.log(`Borrados ${ids.length} inmuebles de muestra`);
    return { properties: ids.length, images: fotos.length };
  }
}
