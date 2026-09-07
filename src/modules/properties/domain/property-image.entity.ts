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

  /**
   * El retoque con IA que esta viendose AHORA en esta foto, si lo hay.
   *
   * Nulo significa fotografia: lo que salio de la camara, pasado por nuestro
   * reencodeo y nada mas. No nulo significa que lo que ve el visitante lo
   * dibujo un modelo, y la fila de `image_retouch` a la que apunta dice que se
   * le pidio, con que modelo, quien lo pulso y quien lo acepto.
   *
   * Es una sola columna y no un booleano `retocada` porque un booleano no
   * contesta la pregunta que de verdad se hace seis meses despues, que nunca es
   * "¿esta retocada?" sino "¿que le hicieron y quien dijo que si?".
   *
   * Vive aqui y no en `ImageAsset` —que comparten proyecto y tipologia— porque
   * el retoque solo existe para fotos de inmueble. Las de un proyecto en obra
   * son renders del constructor: ya son dibujos y nadie los confunde con una
   * foto.
   *
   * SIN clave ajena a proposito. La relacion natural apunta al reves —
   * `image_retouch` referencia a `property_image` con borrado en cascada— y
   * declarar tambien esta direccion crearia un ciclo de dependencia entre las
   * dos tablas que complica el borrado de un inmueble sin aportar nada: la
   * integridad que importa es que el retoque muera con la foto, y esa ya esta.
   */
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Retoque con IA que se esta mostrando; nulo si es la foto real',
  })
  @Index()
  @Column({ name: 'retouch_id', type: 'uuid', nullable: true })
  retouchId: string | null;
}
