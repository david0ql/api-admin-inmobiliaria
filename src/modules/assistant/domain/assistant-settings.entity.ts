import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * Lo que la agencia le añade al asistente por su cuenta.
 *
 * Fila única. El post-prompt va DESPUÉS de todo lo nuestro y de las reglas: lo
 * último que lee el modelo es lo que más pesa, y esto es la palabra de la
 * agencia sobre la nuestra.
 */
@Entity('assistant_settings')
export class AssistantSettings extends BaseEntity {
  @ApiProperty({ description: 'Instrucciones libres, al final del prompt.' })
  @Column({ type: 'text', default: '' })
  postPrompt: string;
}
