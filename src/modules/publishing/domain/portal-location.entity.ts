import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Equivalencia entre nuestra geografia y la de un portal.
 *
 * Nuestras ciudades y zonas vienen de WASI; cada portal tiene su propio arbol
 * con sus propios ids —Fincaraiz con uuids de barrio, Metrocuadrado con codigos
 * de ciudad y barrio— y no hay forma fiable de cruzarlos solo por nombre:
 * muchas "zonas" de WASI son conjuntos o vias, no barrios. Por eso la
 * equivalencia se guarda, se propone sola cuando el nombre coincide y se
 * revisa a mano cuando no.
 *
 * `zoneId` nulo es la equivalencia de la ciudad entera: lo que se usa cuando
 * el inmueble no tiene zona o su zona aun no esta emparejada.
 */
@Entity('portal_location')
@Index('uq_portal_location', ['portalId', 'cityId', 'zoneKey'], {
  unique: true,
})
export class PortalLocation {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'portal_id', type: 'int' })
  portalId: number;

  @ApiProperty()
  @Column({ name: 'city_id', type: 'int' })
  cityId: number;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'zone_id', type: 'int', nullable: true })
  zoneId: number | null;

  /**
   * `zone_id` con 0 en lugar de nulo, para que la unicidad funcione: en
   * Postgres dos nulos no chocan y habria dos equivalencias de ciudad.
   */
  @Column({
    name: 'zone_key',
    type: 'int',
    generatedType: 'STORED',
    asExpression: 'coalesce(zone_id, 0)',
    insert: false,
    update: false,
  })
  zoneKey: number;

  @ApiProperty({ description: 'Id en el portal' })
  @Column({ name: 'external_id', type: 'varchar', length: 120 })
  externalId: string;

  @ApiProperty()
  @Column({ name: 'external_name', type: 'varchar', length: 300 })
  externalName: string;

  /** Lo que el portal necesite ademas del id: el id de ciudad padre, el tipo. */
  @ApiProperty()
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  extra: Record<string, string>;

  /** Propuesta automatica sin revisar: se usa, pero el panel la marca. */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
