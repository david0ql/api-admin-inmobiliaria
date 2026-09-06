import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImageAsset } from '../../media/image-asset.entity';
import { PropertyFamily } from './property-family.entity';

/**
 * Imagen de un proyecto.
 *
 * Hasta ahora un proyecto tenia `cover_url` y nada mas: una sola foto, escrita
 * a mano como texto. Pero lo que vende obra nueva son la fachada, la piscina,
 * el salon comunal y la implantacion del conjunto, y ninguna de esas es una
 * unidad concreta que se pueda tomar prestada de un inmueble — un proyecto
 * sobre planos puede no tener todavia ningun inmueble cargado.
 *
 * `cover_url` se queda porque hay cinco proyectos que la tienen puesta y
 * apuntan fuera; cuando la galeria tiene portada, manda la galeria.
 */
@Entity('family_image')
@Index(['familyId', 'position'])
export class FamilyImage extends ImageAsset {
  @ManyToOne(() => PropertyFamily, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'family_id' })
  family?: PropertyFamily;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;
}
