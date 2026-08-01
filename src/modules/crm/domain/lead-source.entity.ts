import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * Origen del lead.
 *
 * En WASI esto vivia como texto libre en `reference`, y el resultado son 4.857
 * clientes de "Proppit", 585 de "Página web", 69 de "Mercadolibre" y un puñado
 * de valores sueltos como el nombre de una asesora. Normalizarlo es lo que
 * permite responder que canal trae los clientes que de verdad convierten.
 */
@Entity('lead_source')
export class LeadSource extends BaseEntity {
  @ApiProperty({ example: 'Proppit' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Valores originales de WASI que se consolidan aqui (doomos.info, Doomos…). */
  @ApiProperty({ type: [String] })
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  aliases: string[];

  @ApiProperty({
    description: 'Canal de pago: permite calcular coste por lead',
  })
  @Column({ type: 'boolean', default: false })
  paid: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  active: boolean;
}
