import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from '../../iam/domain/agent.entity';
import { City } from '../../catalog/domain/geography.entity';
import { ClientType } from '../../catalog/domain/catalogs.entity';
import { Pipeline, PipelineStage } from './pipeline.entity';
import { LeadSource } from './lead-source.entity';
import { PropertyInterest } from './property-interest.entity';

/**
 * Cliente / lead.
 *
 * Se descartan los campos que WASI expone pero la agencia nunca lleno en sus
 * 7.529 registros: `tag` (0 %) y `address` (0,1 %, y con datos que en realidad
 * eran telefonos o nombres de conyuge).
 *
 * `phoneNormalized` es propio: hay 554 moviles repetidos entre clientes, asi que
 * la deteccion de duplicados necesita una forma canonica sobre la que indexar.
 */
@Entity('client')
@Index(['pipelineId', 'stageId'])
@Index(['assignedAgentId', 'stageId'])
export class Client extends BaseEntity {
  @ApiPropertyOptional({ description: 'id_client original en WASI' })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 160, nullable: true })
  lastName: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 180, nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  cellPhone: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  /** Solo digitos, sin prefijo internacional: la clave para cruzar duplicados. */
  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNormalized: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  identification: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'date', nullable: true })
  birthday: string | null;

  // --- clasificacion comercial -------------------------------------------

  @ManyToMany(() => ClientType, { eager: true })
  @JoinTable({
    name: 'client_client_type',
    joinColumn: { name: 'client_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'client_type_id', referencedColumnName: 'id' },
  })
  types: ClientType[];

  @ManyToOne(() => Pipeline, { nullable: false, eager: true })
  @JoinColumn({ name: 'pipeline_id' })
  pipeline: Pipeline;

  @ApiProperty()
  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId: string;

  @ManyToOne(() => PipelineStage, { nullable: false, eager: true })
  @JoinColumn({ name: 'stage_id' })
  stage: PipelineStage;

  @ApiProperty()
  @Column({ name: 'stage_id', type: 'uuid' })
  stageId: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cuando entro en la etapa actual',
  })
  @Column({ type: 'timestamptz', nullable: true })
  stageChangedAt: Date | null;

  @ManyToOne(() => LeadSource, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'source_id' })
  source: LeadSource | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  // --- ubicacion y responsable -------------------------------------------

  @ManyToOne(() => City, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'city_id' })
  city: City | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'city_id', type: 'int', nullable: true })
  cityId: number | null;

  @ManyToOne(() => Agent, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_agent_id' })
  assignedAgent: Agent | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assignedAgentId: string | null;

  // --- notas y preferencias ----------------------------------------------

  @ApiPropertyOptional({ nullable: true, description: 'Que busca el cliente' })
  @Column({ type: 'text', nullable: true })
  requirement: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'Autoriza recibir informacion comercial' })
  @Column({ type: 'boolean', default: false })
  acceptsMarketing: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ultima interaccion registrada',
  })
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastContactedAt: Date | null;

  @OneToMany(() => PropertyInterest, (i) => i.client)
  interests: PropertyInterest[];

  @Column({
    type: 'text',
    generatedType: 'STORED',
    asExpression: `lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(cell_phone,'') || ' ' || coalesce(identification,''))`,
    select: false,
    nullable: true,
  })
  searchText: string;

  @ApiProperty()
  get fullName(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ').trim();
  }
}
