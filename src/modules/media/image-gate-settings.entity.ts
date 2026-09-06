import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from '../../shared/database/base.entity';
import { GateProfile } from './image-gate.rules';

/**
 * Lo que la agencia ha cambiado de los umbrales de la puerta.
 *
 * Mismo patron que las traducciones: el valor de partida vive en el repositorio
 * (`DEFAULT_RULES`), que es lo que decidio quien programa con las 6.306 fotos
 * delante, y esta tabla es la capa de encima con lo que la agencia decidio en
 * su lugar. Se guarda solo lo TOCADO, clave a clave: subir el minimo de ancho
 * no congela el resto de umbrales en el valor que tuvieran ese dia, y borrar la
 * fila devuelve los de fabrica.
 *
 * Una fila por perfil, porque el liston del inventario y el de la solicitud de
 * un propietario no son el mismo y no deben poder confundirse.
 */
@Entity('image_gate_settings')
@Unique(['profile'])
export class ImageGateSettings extends BaseEntity {
  @ApiProperty({ enum: GateProfile })
  @Column({ type: 'enum', enum: GateProfile })
  profile: GateProfile;

  /**
   * Solo los umbrales cambiados. `jsonb` y no una columna por umbral porque
   * anadir una regla nueva no puede exigir una migracion: la lista de reglas
   * la manda `gateRulesSchema`, que valida esto al leerlo y al escribirlo.
   */
  @ApiProperty({
    description: 'Umbrales sobrescritos; el resto van por defecto',
  })
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  overrides: Record<string, number | boolean>;

  /** Quien lo cambio la ultima vez. Un umbral movido sin dueño no se discute. */
  @ApiProperty({ nullable: true })
  @Column({ name: 'updated_by_agent_id', type: 'uuid', nullable: true })
  updatedByAgentId: string | null;
}
