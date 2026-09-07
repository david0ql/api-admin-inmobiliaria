import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Index } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import type { Revelado } from './image-develop.service';

/**
 * Qué es la imagen, no dónde cuelga.
 *
 * El plano no es una foto más: es lo que el comprador de obra nueva abre
 * primero de una tipología, y la web lo enseña aparte del carrusel. Sin esta
 * columna la única forma de distinguirlo sería la posición o el nombre del
 * fichero, que es adivinar.
 *
 * El tipo de Postgres se llama `image_kind_enum` —y no `unit_type_image_kind_
 * enum` -- porque lo comparten las tres tablas: son la misma pregunta.
 */
export enum ImageKind {
  /** Lo construido o lo renderizado: lo que se ve. */
  PHOTO = 'PHOTO',
  /** El plano: distribución, cotas, orientación. */
  FLOOR_PLAN = 'FLOOR_PLAN',
}

/**
 * Lo que toda imagen del sistema tiene, viva donde viva.
 *
 * Es una clase abstracta y no una tabla: cada dueño —inmueble, proyecto,
 * tipología— tiene la suya, con su clave ajena de verdad y su `ON DELETE
 * CASCADE`. La alternativa era una tabla polimórfica con `owner_type` +
 * `owner_id`, y se descartó por dos motivos que se pagan a diario: no se puede
 * declarar la clave ajena —nada impide una fila apuntando a un proyecto que ya
 * no existe, y el borrado en cascada habría que escribirlo a mano en cada
 * servicio— y TypeORM no sabe unir una relación cuyo destino depende de una
 * columna, asi que cada `leftJoinAndSelect` de la galería pasaría a ser una
 * consulta suelta más un emparejado en memoria.
 *
 * Lo que se comparte de verdad no es la tabla, es el comportamiento —subir,
 * ordenar, elegir portada, borrar—, y eso vive una sola vez en
 * `ImageCollectionService`. Tres tablas con las mismas columnas cuestan tres
 * `CREATE TABLE`; la lógica repetida es la que se desincroniza.
 */
export abstract class ImageAsset extends BaseEntity {
  /** Clave del fichero original dentro de `uploads/`. */
  @ApiProperty({ example: 'families/1f2e.../8ac1-o.webp' })
  @Column({ type: 'varchar', length: 300 })
  storageKey: string;

  @ApiProperty({ description: 'Version para listados (560 px)' })
  @Column({ type: 'text' })
  url: string;

  @ApiProperty({ description: 'Version para la tarjeta en movil (800 px)' })
  @Column({ type: 'text', nullable: true })
  urlMedium: string | null;

  @ApiProperty({ description: 'Version para la ficha (1600 px)' })
  @Column({ type: 'text' })
  urlLarge: string;

  @ApiProperty({ description: 'Original recomprimido' })
  @Column({ type: 'text' })
  urlOriginal: string;

  /** Huella del binario: evita volver a descargar lo mismo al reimportar. */
  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum: string | null;

  /**
   * Huella de la ESCENA, no de los bytes: un dHash de 64 bits en hexadecimal.
   *
   * `checksum` solo caza el mismo fichero subido dos veces. Esto caza la misma
   * foto reexportada, recomprimida o llegada por WhatsApp, que es como se
   * cuelan de verdad las repetidas: en el inventario de produccion hay 530
   * imagenes con checksum repetido y 844 en grupos con la misma huella, 121 de
   * ellas copias del mismo placeholder de 500x500.
   *
   * Nullable porque las 6.306 que ya estaban no la tienen: se calcula al subir,
   * y lo viejo se rellena cuando se toque, no con una migracion que reabra 4,5
   * GB de ficheros.
   */
  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({
    name: 'perceptual_hash',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  perceptualHash: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  width: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  height: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Suma de las variantes en disco, negativo incluido',
  })
  @Column({ type: 'int', nullable: true })
  bytes: number | null;

  /**
   * La misma foto SIN revelar, en tamaño de listado (560 px) y de ficha
   * (1600 px).
   *
   * Existen para poder COMPARAR. Sin ellas, la única manera de ver cómo era la
   * foto antes del revelado era quitárselo de verdad —una escritura sobre el
   * anuncio de un cliente para poder mirarlo—, y sin comparación no hay forma
   * de saber si el revelado mejoró la foto, que es justo lo que se pidió.
   *
   * No se sirve el negativo directamente porque está a 2560 px: una rejilla de
   * comparación con 6.306 fotos a ese tamaño no se puede pintar.
   *
   * Nulas en las fotos que todavía no han pasado por el revelado; ahí no hay
   * "antes" que enseñar porque lo que se ve YA es el antes.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'url_raw', type: 'text', nullable: true })
  urlRaw: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'url_raw_large', type: 'text', nullable: true })
  urlRawLarge: string | null;

  /**
   * Cuándo se reveló la foto. Nulo mientras no se haya revelado.
   *
   * Es lo que hace que el proceso de las 6.306 antiguas se pueda cortar y
   * reanudar: lo pendiente es lo que tiene esta columna a nulo, no un contador
   * en un fichero. Y es lo que distingue "revelada y no necesitaba nada" de
   * "sin revelar todavía", que se ven igual si solo se mira `develop`.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'developed_at', type: 'timestamptz', nullable: true })
  developedAt: Date | null;

  /**
   * QUÉ se le hizo a la foto: ganancia, desplazamiento, factores de canal y
   * gamma, más la versión del criterio.
   *
   * Se guarda por tres motivos y ninguno es decorativo. Deshacer necesita
   * saber que hubo algo que deshacer; afinar el criterio necesita poder
   * rerevelar solo lo hecho con la versión vieja sin volver a mirar 4,5 GB de
   * ficheros; y el día que un asesor diga que una foto salió rara, la única
   * respuesta útil es el número que se le aplicó.
   *
   * Nulo con `developed_at` puesto significa lo mejor que puede pasar: se miró
   * y no hacía falta tocarla.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  develop: Revelado | null;

  /** El pie de foto que escribe la agencia: "Fachada", "Planta tipo". */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @ApiProperty({ enum: ImageKind, description: 'Foto o plano' })
  @Column({
    type: 'enum',
    enum: ImageKind,
    enumName: 'image_kind_enum',
    default: ImageKind.PHOTO,
  })
  kind: ImageKind;

  @ApiProperty({ description: 'Orden dentro de la ficha, 1 es la primera' })
  @Column({ type: 'smallint', default: 1 })
  position: number;

  @ApiProperty({ description: 'Imagen de portada' })
  @Column({ type: 'boolean', default: false })
  isMain: boolean;
}
