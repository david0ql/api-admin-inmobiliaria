import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from '../../iam/domain/agent.entity';
import { Client } from '../../crm/domain/client.entity';
import { Property } from '../../properties/domain/property.entity';

export enum AppointmentType {
  /** Visita al inmueble: el caso mayoritario. */
  VISIT = 'VISIT',
  CALL = 'CALL',
  MEETING = 'MEETING',
  /** Firma de promesa o escritura. */
  SIGNING = 'SIGNING',
  /** Sesion de fotos para la captacion. */
  PHOTO_SHOOT = 'PHOTO_SHOOT',
  APPRAISAL = 'APPRAISAL',
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  DONE = 'DONE',
  CANCELED = 'CANCELED',
  /** El cliente no se presento: dato clave para depurar la cartera. */
  NO_SHOW = 'NO_SHOW',
}

/**
 * Cita de agenda.
 *
 * No procede de WASI — su API v1 no tiene calendario — pero es la pieza que
 * cierra el circuito: sin agenda, el embudo no se puede trabajar y el asesor
 * acaba llevando las visitas en el movil.
 */
@Entity('appointment')
@Index(['agentId', 'startsAt'])
@Index(['startsAt', 'status'])
export class Appointment extends BaseEntity {
  @ApiProperty({ enum: AppointmentType })
  @Column({
    type: 'enum',
    enum: AppointmentType,
    default: AppointmentType.VISIT,
  })
  type: AppointmentType;

  @ApiProperty({ enum: AppointmentStatus })
  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.SCHEDULED,
  })
  status: AppointmentStatus;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE', nullable: false, eager: true })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @ApiProperty()
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  /**
   * Sede de la cita. Nullable porque la agenda se puede alimentar desde la web
   * publica, donde todavia no se sabe que oficina la atiende: se rellena al
   * asignarle asesor.
   */
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @ManyToOne(() => Client, {
    onDelete: 'SET NULL',
    nullable: true,
    eager: true,
  })
  @JoinColumn({ name: 'client_id' })
  client: Client | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ManyToOne(() => Property, {
    onDelete: 'SET NULL',
    nullable: true,
    eager: true,
  })
  @JoinColumn({ name: 'property_id' })
  property: Property | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Punto de encuentro si no es el inmueble',
  })
  @Column({ type: 'varchar', length: 300, nullable: true })
  location: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Resultado que deja el asesor al cerrar la cita. */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  outcome: string | null;
}
