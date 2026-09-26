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
  /** Retirado del portal por nosotros: el anuncio ya no esta arriba. */
  REMOVED = 'REMOVED',
}

/** Lo que falta por hacer en el portal, si algo. */
export enum SyncAction {
  /** Crear el anuncio, o actualizarlo si ya existe. */
  UPSERT = 'UPSERT',
  /** Retirarlo. */
  REMOVE = 'REMOVE',
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

  // --- sincronizacion ----------------------------------------------------
  //
  // La fila hace de cola: `pendingAction` dice que hay que hacer y
  // `nextAttemptAt` cuando. Una tabla de trabajos aparte duplicaria el estado
  // —¿que manda si la cola dice "enviar" y la publicacion "retirado"?— y la API
  // corre en un solo proceso, asi que no hace falta un broker.

  @ApiPropertyOptional({
    nullable: true,
    description: 'Id del anuncio en el portal',
  })
  @Column({ name: 'external_id', type: 'varchar', length: 120, nullable: true })
  externalId: string | null;

  @ApiPropertyOptional({ enum: SyncAction, nullable: true })
  @Column({
    name: 'pending_action',
    type: 'enum',
    enum: SyncAction,
    enumName: 'publication_sync_action_enum',
    nullable: true,
  })
  pendingAction: SyncAction | null;

  /**
   * Cuando toca el proximo intento. Nulo con accion pendiente significa "en
   * espera": el inmueble todavia no se puede publicar (borrador, sin fotos) y
   * se reintenta solo cuando alguien lo edita.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /**
   * Operacion en curso en un portal asincrono (Fincaraiz, Metrocuadrado): el
   * envio se acepta y el resultado llega despues, por callback o consultando.
   */
  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  transactionId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  /**
   * Huella de lo que se envio la ultima vez. Si la ficha cambia, la huella
   * actual deja de coincidir y el panel ofrece "Actualizar": asi se sabe que
   * anuncios estan desfasados sin reenviar nada.
   */
  @Column({ name: 'synced_hash', type: 'varchar', length: 64, nullable: true })
  syncedHash: string | null;
}
