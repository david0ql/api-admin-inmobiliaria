import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Property } from './property.entity';

/**
 * Imagen de un inmueble.
 *
 * WASI mete una capa de "galerias" entre el inmueble y sus fotos, pero en los
 * 642 inmuebles hay exactamente una galeria por inmueble, siempre. Esa capa no
 * aporta nada, asi que se colapsa: las imagenes cuelgan directamente del
 * inmueble y el `id_gallery` original queda en `property.wasiGalleryId`.
 *
 * Los ficheros son nuestros: se guardan bajo `uploads/` y se sirven desde
 * `/media/...`. `sourceUrl` conserva de donde vino la foto original, pero no se
 * usa para mostrarla — el dia que se cierre la cuenta de WASI, el inventario
 * sigue teniendo sus imagenes.
 */
@Entity('property_image')
@Index(['propertyId', 'position'])
export class PropertyImage extends BaseEntity {
  @ManyToOne(() => Property, (p) => p.images, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  /** Clave del fichero original dentro de `uploads/`. */
  @ApiProperty({ example: 'properties/1f2e.../8ac1-o.webp' })
  @Column({ type: 'varchar', length: 300 })
  storageKey: string;

  @ApiProperty({ description: 'Version para listados (560 px)' })
  @Column({ type: 'text' })
  url: string;

  @ApiProperty({ description: 'Version para la ficha (1600 px)' })
  @Column({ type: 'text' })
  urlLarge: string;

  @ApiProperty({ description: 'Original recomprimido' })
  @Column({ type: 'text' })
  urlOriginal: string;

  @ApiPropertyOptional({ nullable: true, description: 'De donde se importo' })
  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;

  /** Huella del binario: evita volver a descargar lo mismo al reimportar. */
  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  width: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  height: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Suma de las tres variantes',
  })
  @Column({ type: 'int', nullable: true })
  bytes: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Orden dentro de la ficha, 1 es la primera' })
  @Column({ type: 'smallint', default: 1 })
  position: number;

  @ApiProperty({ description: 'Imagen de portada' })
  @Column({ type: 'boolean', default: false })
  isMain: boolean;
}
