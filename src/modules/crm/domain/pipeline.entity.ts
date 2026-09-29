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
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * De que sede es el embudo. En blanco, de toda la empresa.
   *
   * Un embudo describe COMO trabaja un equipo, y eso cambia de una oficina a
   * otra: la de obra nueva vende sobre planos y la de usado hace visitas. Que
   * todos vieran los tres embudos de la empresa obligaba a cada asesor a
   * distinguir a ojo cuales eran los suyos.
   */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @Index()
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  /**
   * Que perfiles lo ven. Lista vacia: todos.
   *
   * Vacia y no "null" a proposito: el caso corriente es que un embudo lo vea
   * todo el mundo, y con una lista vacia esa respuesta no necesita comprobar si
   * el campo existe. Quien lo crea decide a quien se lo enseña, y quien no
   * aparece no lo ve ni sabe que hay.
   */
  @ApiProperty({ type: [String], example: ['AGENT', 'COORDINATOR'] })
  @Column({ name: 'visible_roles', type: 'jsonb', default: () => "'[]'::jsonb" })
  visibleRoles: string[];

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
