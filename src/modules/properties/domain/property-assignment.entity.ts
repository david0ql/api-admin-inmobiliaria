import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from '../../iam/domain/agent.entity';
import { Property } from './property.entity';

export enum AssignmentRole {
  /** Quien capto el inmueble (trae al propietario). */
  CAPTURE = 'CAPTURE',
  /** Quien lo tiene en cartera y lo muestra. */
  LISTING = 'LISTING',
  /** Apoyo puntual: fotografia, avaluo, cierre. */
  SUPPORT = 'SUPPORT',
}

/**
 * Historico de asignaciones inmueble - asesor.
 *
 * WASI solo guarda el asesor actual en `id_user`, asi que al reasignar se pierde
 * quien capto el inmueble. Ese dato es justamente el que decide el reparto de
 * comision, de modo que aqui se conserva la cadena completa: el registro con
 * `unassignedAt` nulo es el vigente.
 */
@Entity('property_assignment')
@Index(['propertyId', 'unassignedAt'])
export class PropertyAssignment extends BaseEntity {
  @ManyToOne(() => Property, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE', nullable: false, eager: true })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @ApiProperty()
  @Index()
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ApiProperty({ enum: AssignmentRole })
  @Column({
    type: 'enum',
    enum: AssignmentRole,
    default: AssignmentRole.LISTING,
  })
  role: AssignmentRole;

  @ApiProperty()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  assignedAt: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Nulo mientras la asignacion siga vigente',
  })
  @Column({ type: 'timestamptz', nullable: true })
  unassignedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Quien hizo la reasignacion',
  })
  @Column({ name: 'assigned_by_agent_id', type: 'uuid', nullable: true })
  assignedByAgentId: string | null;
}
