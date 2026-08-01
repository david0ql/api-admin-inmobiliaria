import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';

/**
 * Arbol geografico pais > region > ciudad > zona.
 *
 * Los catalogos conservan el id entero de WASI como clave primaria: es estable,
 * ya viene referenciado en los 642 inmuebles y en los 7.529 clientes, y hace que
 * reimportar sea un upsert trivial en lugar de una tabla de equivalencias.
 */
@Entity('country')
export class Country {
  @ApiProperty({ example: 1 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Colombia' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 'CO', nullable: true })
  @Column({ type: 'varchar', length: 8, nullable: true })
  iso: string | null;

  @OneToMany(() => Region, (r) => r.country)
  regions: Region[];
}

@Entity('region')
export class Region {
  @ApiProperty({ example: 29 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Santander' })
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @ManyToOne(() => Country, (c) => c.regions, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'country_id' })
  country: Country;

  @ApiProperty()
  @Index()
  @Column({ name: 'country_id', type: 'int' })
  countryId: number;

  @OneToMany(() => City, (c) => c.region)
  cities: City[];
}

@Entity('city')
export class City {
  @ApiProperty({ example: 105 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Bucaramanga' })
  @Index()
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @ManyToOne(() => Region, (r) => r.cities, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'region_id' })
  region: Region;

  @ApiProperty()
  @Index()
  @Column({ name: 'region_id', type: 'int' })
  regionId: number;

  @OneToMany(() => Zone, (z) => z.city)
  zones: Zone[];
}

@Entity('zone')
export class Zone {
  @ApiProperty({ example: 388533 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Lagos Del Cacique' })
  @Index()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @ManyToOne(() => City, (c) => c.zones, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'city_id' })
  city: City;

  @ApiProperty()
  @Index()
  @Column({ name: 'city_id', type: 'int' })
  cityId: number;
}
