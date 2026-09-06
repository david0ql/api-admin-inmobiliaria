import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ImageAsset } from '../../media/image-asset.entity';
import { UnitType } from './unit-type.entity';

/**
 * Imagen de una tipologia: casi siempre, el plano.
 *
 * Es la tabla que justifica que `kind` exista. Quien mira el "Tipo A" de un
 * proyecto quiere ver la distribucion —donde da la alcoba principal, si el
 * balcon es del salon o del cuarto—, y eso es un plano, no una foto de la sala
 * amueblada del apartamento piloto. Las dos cosas cuelgan de la misma
 * tipologia y la web las enseña en sitios distintos, asi que tienen que poder
 * distinguirse por dato y no por convencion.
 */
@Entity('unit_type_image')
@Index(['unitTypeId', 'position'])
export class UnitTypeImage extends ImageAsset {
  @ManyToOne(() => UnitType, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'unit_type_id' })
  unitType?: UnitType;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'unit_type_id', type: 'uuid' })
  unitTypeId: string;
}
