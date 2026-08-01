import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from './agent.entity';

export enum ShiftKind {
  /** Turno de oficina: atiende presencialmente. */
  OFFICE = 'OFFICE',
  /** Guardia: recibe los leads entrantes fuera de horario. */
  ON_CALL = 'ON_CALL',
}

/**
 * Turnos y guardias del equipo. Es la base del calendario: una cita solo se
 * puede agendar dentro de la franja del asesor, y los leads que entran fuera
 * de horario se enrutan a quien esta de guardia.
 */
@Entity('agent_shift')
@Index(['agent', 'weekday'])
export class AgentShift extends BaseEntity {
  @ManyToOne(() => Agent, (agent) => agent.shifts, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @ApiProperty()
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = domingo … 6 = sabado',
  })
  @Column({ type: 'smallint' })
  weekday: number;

  @ApiProperty({ example: '08:00' })
  @Column({ type: 'time' })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Column({ type: 'time' })
  endTime: string;

  @ApiProperty({ enum: ShiftKind })
  @Column({ type: 'enum', enum: ShiftKind, default: ShiftKind.OFFICE })
  kind: ShiftKind;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'date', nullable: true })
  validFrom: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'date', nullable: true })
  validUntil: string | null;
}
