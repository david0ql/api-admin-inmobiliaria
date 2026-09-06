import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImageAsset } from '../../media/image-asset.entity';
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
 *
 * Todo lo que es "una imagen" —las urls, el orden, la portada, si es foto o
 * plano— esta en `ImageAsset`, que es lo mismo aqui que en la galeria del
 * proyecto y en los planos de la tipologia. Aqui queda solo lo que es del
 * inmueble: de que inmueble es y de donde se importo.
 */
@Entity('property_image')
@Index(['propertyId', 'position'])
export class PropertyImage extends ImageAsset {
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

  @ApiPropertyOptional({ nullable: true, description: 'De donde se importo' })
  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;
}
