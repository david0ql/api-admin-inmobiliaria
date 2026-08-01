import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Portal } from '../../catalog/domain/catalogs.entity';
import { Property } from '../../properties/domain/property.entity';

export enum PublicationState {
  /** Marcado para publicar, pendiente de que el portal lo recoja. */
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
  /** El portal rechazo el anuncio: falta de fotos, datos incompletos, cupo. */
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
}

/**
 * Publicacion de un inmueble en un portal.
 *
 * Es de las pocas cosas con datos densos en WASI: los 642 inmuebles estan
 * activos en 11 portales, unas 7.700 filas reales. Saber donde esta publicado
 * cada inmueble — y desde cuando — es lo que permite justificar el gasto en
 * portales de pago y detectar anuncios caidos.
 */
@Entity('property_publication')
@Unique('uq_publication_property_portal', ['propertyId', 'portalId'])
@Index(['portalId', 'state'])
export class PropertyPublication extends BaseEntity {
  @ManyToOne(() => Property, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => Portal, {
    onDelete: 'CASCADE',
    nullable: false,
    eager: true,
  })
  @JoinColumn({ name: 'portal_id' })
  portal: Portal;

  @ApiProperty()
  @Column({ name: 'portal_id', type: 'int' })
  portalId: number;

  @ApiProperty({ enum: PublicationState })
  @Column({
    type: 'enum',
    enum: PublicationState,
    default: PublicationState.PENDING,
  })
  state: PublicationState;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Motivo del rechazo o la pausa',
  })
  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ficha en el portal' })
  @Column({ type: 'text', nullable: true })
  externalUrl: string | null;
}
