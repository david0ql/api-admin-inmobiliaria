import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * Etiqueta de color sobre el inmueble. La agencia ya la usaba en WASI para
 * marcar el estado operativo al margen de la disponibilidad formal: 534
 * inmuebles "Disponible" y 83 "Alquilado".
 */
@Entity('property_label')
export class PropertyLabel extends BaseEntity {
  @ApiPropertyOptional({ nullable: true })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ApiProperty({ example: 'Disponible' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @ApiProperty({ example: '#6aa84f' })
  @Column({ type: 'varchar', length: 9, default: '#6b7280' })
  color: string;
}
