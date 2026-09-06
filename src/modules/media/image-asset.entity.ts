import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Index } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';

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

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  width: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  height: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Suma de las cuatro variantes',
  })
  @Column({ type: 'int', nullable: true })
  bytes: number | null;

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
