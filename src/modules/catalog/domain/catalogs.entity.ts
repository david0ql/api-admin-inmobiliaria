import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('property_type')
export class PropertyType {
  @ApiProperty({ example: 2 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Apartamento' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Los tipos sin inmuebles se ocultan del selector sin borrarlos del catalogo. */
  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  active: boolean;
}

export enum FeatureScope {
  /** Caracteristica del inmueble en si: closets, ascensor, cocina integral. */
  INTERNAL = 'INTERNAL',
  /** Del entorno o la copropiedad: piscina, porteria, colegios cercanos. */
  EXTERNAL = 'EXTERNAL',
}

@Entity('feature')
export class Feature {
  @ApiProperty({ example: 116 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Agua' })
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @ApiProperty({ enum: FeatureScope })
  @Index()
  @Column({ type: 'enum', enum: FeatureScope })
  scope: FeatureScope;
}

@Entity('currency')
export class Currency {
  @ApiProperty({ example: 1 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'COP' })
  @Column({ type: 'varchar', length: 8 })
  iso: string;

  @ApiProperty({ example: 'Pesos Colombianos' })
  @Column({ type: 'varchar', length: 80 })
  name: string;
}

@Entity('client_type')
export class ClientType {
  @ApiProperty({ example: 7 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Buscando' })
  @Column({ type: 'varchar', length: 80 })
  name: string;
}

@Entity('portal')
export class Portal {
  @ApiProperty({ example: 30 })
  @PrimaryColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Fincaraiz' })
  @Column({ type: 'varchar', length: 160 })
  name: string;

  /** Si el portal cobra por publicar; sirve para el coste de la difusion. */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  paid: boolean;

  /** La cuenta tiene credenciales activas con este portal. */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  connected: boolean;
}
