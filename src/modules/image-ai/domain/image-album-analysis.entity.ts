import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { RoomKind } from './image-analysis.enums';

/**
 * El juicio del modelo sobre la galeria ENTERA de un inmueble.
 *
 * Aparte del juicio por foto porque son dos preguntas distintas: "¿esta bien
 * esta foto?" se contesta mirando una, y "¿en que orden van y cual es la
 * portada?" solo se puede contestar viendolas todas. La portada es la foto que
 * vende, y elegirla es comparar, no puntuar.
 *
 * `missing` es lo que no hay: si un apartamento de tres alcobas no tiene ni una
 * foto de la cocina, eso no lo detecta mirando fotos sueltas y es lo que mas
 * visitas cuesta.
 */
@Entity('image_album_analysis')
@Index(['propertyId'])
export class ImageAlbumAnalysis extends BaseEntity {
  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ApiProperty()
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ApiProperty({ type: [String], description: 'Ids de imagen, en orden' })
  @Column({
    name: 'suggested_order',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  suggestedOrder: string[];

  @ApiPropertyOptional({ nullable: true, description: 'La portada propuesta' })
  @Column({ name: 'cover_image_id', type: 'uuid', nullable: true })
  coverImageId: string | null;

  @ApiProperty({ enum: RoomKind, isArray: true, description: 'Lo que falta' })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  missing: RoomKind[];

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @ApiProperty()
  @Column({ name: 'prompt_version', type: 'int' })
  promptVersion: number;

  @ApiProperty()
  @Column({ type: 'varchar', length: 80 })
  model: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'created_by_agent_id', type: 'uuid', nullable: true })
  createdByAgentId: string | null;
}
