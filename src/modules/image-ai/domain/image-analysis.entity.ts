import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { PropertyImage } from '../../properties/domain/property-image.entity';
import { RoomKind } from './image-analysis.enums';

/** Lo que el modelo dice que no deberia salir a una web publica. */
export interface PrivacyFlags {
  faces: boolean;
  plates: boolean;
  documents: boolean;
  screens: boolean;
  /**
   * La direccion o el nombre del edificio, legibles en la foto: la
   * nomenclatura pintada en la fachada, el rotulo de la entrada, el numero de
   * la casa.
   *
   * Va aparte de `documents` y no dentro, aunque las dos cosas sean "texto que
   * identifica": es con diferencia lo que mas aparece, y mezclarlo con recibos
   * y cedulas hace que el asesor no sepa que esta mirando. Ademas el riesgo es
   * distinto — una cedula no debe publicarse nunca, y una direccion legible es
   * una decision comercial de la agencia.
   *
   * Puede faltar en los analisis guardados antes de que existiera. Eso es
   * honesto: no significa que no hubiera direccion, significa que no se
   * pregunto.
   */
  address: boolean;
  notes: string | null;
}

/**
 * El juicio del modelo sobre UNA foto.
 *
 * Se guarda —y no se recalcula al vuelo— por tres razones, y las tres son la
 * misma: cada llamada cuesta dinero. Abrir la pantalla del inmueble no puede
 * volver a pagar el analisis; repetir el mismo lote por equivocacion tampoco; y
 * sin resultados guardados no se puede comparar una version del prompt con la
 * siguiente.
 *
 * La clave unica es (imagen, version del prompt, modelo) a proposito: analizar
 * la misma foto con el prompt v3 y con el v4 tiene que dejar DOS filas, porque
 * comparar las dos es justo para lo que existe el versionado. Repetir con el
 * mismo prompt y el mismo modelo, en cambio, pisa la fila anterior: es la misma
 * pregunta.
 */
@Entity('image_analysis')
@Unique(['propertyImageId', 'promptVersion', 'model'])
@Index(['propertyImageId'])
@Index(['batchId'])
export class ImageAnalysis extends BaseEntity {
  @ManyToOne(() => PropertyImage, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'property_image_id' })
  image: PropertyImage;

  @ApiProperty()
  @Column({ name: 'property_image_id', type: 'uuid' })
  propertyImageId: string;

  /** Redundante con la imagen, pero deja consultar por inmueble sin join. */
  @ApiProperty()
  @Index()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ApiProperty({ enum: RoomKind })
  @Column({ type: 'enum', enum: RoomKind, default: RoomKind.OTHER })
  room: RoomKind;

  @ApiProperty({ description: 'Cuanto se fia el modelo de la estancia, 0-1' })
  @Column({ name: 'room_confidence', type: 'real', default: 0 })
  roomConfidence: number;

  @ApiProperty({ description: 'Calidad fotografica, 0-100' })
  @Column({ type: 'smallint', default: 0 })
  quality: number;

  @ApiProperty({ description: 'Aptitud para ser la portada, 0-100' })
  @Column({ name: 'cover_score', type: 'smallint', default: 0 })
  coverScore: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Pie sugerido; sirve de texto alternativo en la web',
  })
  @Column({ type: 'varchar', length: 300, nullable: true })
  caption: string | null;

  @ApiProperty({ type: [String], description: 'Que esta mal' })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  issues: string[];

  @ApiProperty({ type: [String], description: 'Que deberia hacer el asesor' })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  fixes: string[];

  /**
   * Caras, placas de vehiculo, documentos y pantallas.
   *
   * Esto no es un matiz estetico: la ficha es una pagina publica indexada por
   * Google. Una placa legible o la cara del inquilino en la foto de la sala es
   * un dato de una persona que no ha dado permiso para eso.
   */
  @ApiProperty()
  @Column({
    type: 'jsonb',
    default: () =>
      `'{"faces":false,"plates":false,"documents":false,"screens":false,"notes":null}'::jsonb`,
  })
  privacy: PrivacyFlags;

  @ApiProperty({ description: 'Si sirve para publicar tal cual' })
  @Column({ type: 'boolean', default: true })
  usable: boolean;

  /**
   * Con que version del prompt y con que modelo salio esto. Sin las dos cosas,
   * un resultado viejo no se puede comparar con uno nuevo ni se sabe si el
   * cambio vino de tocar el prompt o de que el proveedor movio el modelo.
   */
  @ApiProperty()
  @Column({ name: 'prompt_version', type: 'int' })
  promptVersion: number;

  /**
   * Huella del TEXTO del prompt con el que salio esto, no de su numero.
   *
   * `promptVersion` dice con que version se pregunto; esto dice con que texto.
   * No son lo mismo: la version es una indireccion que puede cambiar de
   * contenido —nada impide editar el `body` de una version ya usada, y la v1 se
   * siembra de un fichero del repositorio que viaja con el codigo—, y sobre
   * todo no distingue "el prompt se aplico y no cambio nada" de "el prompt no
   * se aplico", que es exactamente la duda que aparece al afinarlo.
   *
   * Nula en los analisis anteriores a esta columna. Es honesto: no significa
   * que no hubiera texto, significa que no se apunto cual.
   */
  @ApiPropertyOptional({ nullable: true, example: 'a3f1c09b7e2d5480' })
  @Column({ name: 'prompt_hash', type: 'varchar', length: 16, nullable: true })
  promptHash: string | null;

  @ApiProperty({ example: 'gpt-4.1-mini' })
  @Column({ type: 'varchar', length: 80 })
  model: string;

  /** El lote en el que se pidio. Agrupa el resultado de conjunto. */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  /**
   * Las metricas de la puerta en el momento del analisis. Se copian aqui para
   * que el resultado se pueda leer entero sin volver a abrir el fichero, y
   * porque son parte de la pregunta que se le hizo al modelo.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'created_by_agent_id', type: 'uuid', nullable: true })
  createdByAgentId: string | null;
}
