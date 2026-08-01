import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export enum ActivityType {
  NOTE = 'NOTE',
  CALL = 'CALL',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  VISIT = 'VISIT',
  OFFER = 'OFFER',
  /** Generada por el sistema al mover al cliente de etapa. */
  STAGE_CHANGE = 'STAGE_CHANGE',
  ASSIGNMENT = 'ASSIGNMENT',
}

/**
 * Bitacora de gestion.
 *
 * La API v1 de Wasi no expone actividades, notas ni tareas: todo el historico
 * comercial de la agencia vivia apelotonado en los campos `comment` y `query`
 * del cliente, en HTML y con las fechas escritas a mano dentro del texto. Esta
 * tabla es lo que convierte eso en algo consultable.
 *
 * Referencia cliente e inmueble por id sin clave foranea dura para poder
 * registrar tambien acciones sobre entidades ya archivadas.
 */
@Entity('activity')
@Index(['clientId', 'occurredAt'])
@Index(['propertyId', 'occurredAt'])
export class Activity extends BaseEntity {
  @ApiProperty({ enum: ActivityType })
  @Index()
  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Quien la registro' })
  @Index()
  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 300 })
  summary: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @ApiProperty()
  @Index()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @ApiProperty({ description: 'true si la genero el sistema, no una persona' })
  @Column({ type: 'boolean', default: false })
  automatic: boolean;
}
