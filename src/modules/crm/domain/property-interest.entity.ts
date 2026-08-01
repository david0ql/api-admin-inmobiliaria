import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Property } from '../../properties/domain/property.entity';
import { Client } from './client.entity';

/**
 * Papel del cliente respecto a un inmueble concreto. En WASI esto se guardaba
 * como `id_client_type` sobre la relacion, mezclando dos cosas distintas: lo
 * que el cliente es en general y lo que es para ese inmueble.
 */
export enum InterestRole {
  /** Consulto o pidio informacion. */
  PROSPECT = 'PROSPECT',
  /** Comprador efectivo o en negociacion. */
  BUYER = 'BUYER',
  /** Vende o arrienda el inmueble. */
  SELLER = 'SELLER',
  /** Titular del inmueble. */
  OWNER = 'OWNER',
  TENANT = 'TENANT',
}

export enum InterestStatus {
  OPEN = 'OPEN',
  VISITED = 'VISITED',
  OFFER_MADE = 'OFFER_MADE',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
}

/**
 * Vinculo cliente - inmueble. Son 2.361 relaciones reales en el volcado, sobre
 * 514 de los 642 inmuebles.
 *
 * `status` y `offeredAmount` no existen en WASI: sin ellos no se puede saber en
 * que punto esta cada negociacion ni cuanto se ofrecio, que es exactamente lo
 * que hace falta para gestionar un cierre.
 */
@Entity('property_interest')
@Unique('uq_interest_client_property_role', ['clientId', 'propertyId', 'role'])
@Index(['propertyId', 'status'])
export class PropertyInterest extends BaseEntity {
  @ManyToOne(() => Client, (c) => c.interests, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @ApiProperty()
  @Index()
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Property, {
    onDelete: 'CASCADE',
    nullable: false,
    eager: true,
  })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ApiProperty({ enum: InterestRole })
  @Column({ type: 'enum', enum: InterestRole, default: InterestRole.PROSPECT })
  role: InterestRole;

  @ApiProperty({ enum: InterestStatus })
  @Column({ type: 'enum', enum: InterestStatus, default: InterestStatus.OPEN })
  status: InterestStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Importe ofrecido' })
  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  offeredAmount: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
