import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { RuleSource } from './chat.enums';

/**
 * Una instrucción que se le añade al asistente.
 *
 * Van al final del prompt del sistema, en orden. Nacen de dos sitios: alguien
 * las escribe, o el modelo las redacta al calificar una respuesta y un humano
 * las aprueba.
 *
 * `active` en lugar de borrar: una regla que se apagó porque hacía más mal que
 * bien es información — quien venga detrás sabrá que ya se probó.
 */
@Entity('assistant_rule')
export class AssistantRule extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'text' })
  text: string;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ApiProperty({ enum: RuleSource })
  @Column({ type: 'enum', enum: RuleSource, default: RuleSource.MANUAL })
  source: RuleSource;

  /** De qué calificación salió, cuando salió de una. */
  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  reviewId: string | null;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  position: number;
}
