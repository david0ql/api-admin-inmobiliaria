import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * El prompt del analisis de imagenes, versionado.
 *
 * El usuario quiere afinarlo el mismo desde el panel, y afinar un prompt es
 * probar, empeorar y volver atras. Por eso no es una fila que se sobrescribe:
 * cada guardado crea una VERSION nueva y la anterior se queda. Volver al
 * anterior es activar su numero, no recuperar nada de una copia de seguridad.
 *
 * Y por eso cada analisis guarda `promptVersion`: sin ese numero al lado del
 * resultado no hay forma de contestar a "¿el cambio de ayer mejoro o empeoro?",
 * que es la unica pregunta que importa cuando se toca un prompt.
 *
 * La version 1 se siembra desde `defaults/analisis-imagenes.md` del repositorio
 * la primera vez que hace falta: el punto de partida lo escribe quien programa,
 * como en las traducciones.
 */
@Entity('image_prompt')
@Unique(['version'])
@Index(['active'])
export class ImagePrompt extends BaseEntity {
  @ApiProperty({ description: 'Correlativo, 1 es la del repositorio' })
  @Column({ type: 'int' })
  version: number;

  @ApiProperty({ description: 'El prompt de sistema completo' })
  @Column({ type: 'text' })
  body: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Por que se cambio, escrito por quien lo cambio',
  })
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  /** Exactamente una version esta activa; es la que se usa al analizar. */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  active: boolean;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'created_by_agent_id', type: 'uuid', nullable: true })
  createdByAgentId: string | null;
}
