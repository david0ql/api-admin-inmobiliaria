import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import type { Agent } from '../../iam/domain/agent.entity';

/**
 * Una sede de la agencia.
 *
 * Hasta ahora la inmobiliaria era una sola oficina y nada lo decia: los 642
 * inmuebles, los 7.529 clientes y los seis asesores simplemente "eran". Al
 * abrir una segunda oficina eso deja de valer, porque lo que un coordinador de
 * Bucaramanga puede ver y tocar no es lo mismo que lo de Bogota.
 *
 * La sede es la unidad de reparto: cuelgan de ella las personas y el
 * inventario, y de ahi salen los permisos. No es una ciudad —una ciudad puede
 * tener dos oficinas y una oficina vender en varias ciudades—, por eso tiene
 * nombre propio y la ciudad es solo un dato mas.
 */
@Entity('branch')
export class Branch extends BaseEntity {
  @ApiProperty({ example: 'Bucaramanga' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Corto y estable: sale en los listados y en los filtros. */
  @ApiProperty({ example: 'BGA' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 12 })
  code: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'city_id', type: 'int', nullable: true })
  cityId: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  /**
   * La sede de la que cuelga todo lo que existia antes de que hubiera sedes.
   *
   * Sirve para dos cosas: es la que se asigna por defecto y es la unica que no
   * se puede borrar, porque quedarse sin ninguna dejaria el sistema sin sitio
   * donde poner un inmueble nuevo.
   */
  @ApiProperty()
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany('Agent', 'branch')
  agents?: Agent[];
}
