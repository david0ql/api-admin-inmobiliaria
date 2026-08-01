import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * Embudo comercial. La agencia ya opera tres en paralelo, y cada uno tiene su
 * propio juego de etapas:
 *   - Clientes (6.443)          — demanda general
 *   - Customer Journey (910)    — seguimiento comercial fino
 *   - Propietarios (176)        — captacion: fotografia, publicacion, publicado
 */
@Entity('pipeline')
export class Pipeline extends BaseEntity {
  @ApiPropertyOptional({ nullable: true })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ApiProperty({ example: 'Clientes' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ description: 'Embudo al que entran los leads sin clasificar' })
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @ApiProperty()
  @Column({ type: 'smallint', default: 0 })
  position: number;

  @OneToMany(() => PipelineStage, (s) => s.pipeline)
  stages: PipelineStage[];
}

/**
 * Etapa dentro de un embudo.
 *
 * `isWon` / `isLost` es lo que WASI no modelaba y obligaba a interpretar el
 * nombre del estado: sin esa marca no se puede calcular una tasa de conversion.
 * De los 7.529 clientes, 1.942 estan en etapas de perdido y 28 en convertido.
 */
@Entity('pipeline_stage')
@Unique('uq_stage_pipeline_name', ['pipelineId', 'name'])
export class PipelineStage extends BaseEntity {
  @ApiPropertyOptional({ nullable: true })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ManyToOne(() => Pipeline, (p) => p.stages, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'pipeline_id' })
  pipeline: Pipeline;

  @ApiProperty()
  @Index()
  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId: string;

  @ApiProperty({ example: 'En Proceso' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ description: 'Orden en el tablero' })
  @Column({ type: 'smallint', default: 0 })
  position: number;

  @ApiProperty({ example: '#6aa84f' })
  @Column({ type: 'varchar', length: 9, default: '#6b7280' })
  color: string;

  @ApiProperty({ description: 'Etapa de cierre con exito' })
  @Column({ type: 'boolean', default: false })
  isWon: boolean;

  @ApiProperty({ description: 'Etapa de descarte' })
  @Column({ type: 'boolean', default: false })
  isLost: boolean;
}
