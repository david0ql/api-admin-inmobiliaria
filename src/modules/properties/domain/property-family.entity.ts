import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Tree,
  TreeChildren,
  TreeParent,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { City, Zone } from '../../catalog/domain/geography.entity';

export enum FamilyKind {
  /** Obra nueva sobre planos o en construcción. */
  PROJECT = 'PROJECT',
  /** Conjunto o urbanización cerrada ya construida. */
  COMPLEX = 'COMPLEX',
  /** Edificio suelto. */
  BUILDING = 'BUILDING',
  /** Etapa o torre dentro de otro conjunto. */
  STAGE = 'STAGE',
}

export enum FamilyStatus {
  PLANNED = 'PLANNED',
  UNDER_CONSTRUCTION = 'UNDER_CONSTRUCTION',
  DELIVERED = 'DELIVERED',
  SOLD_OUT = 'SOLD_OUT',
}

/**
 * Familia: el conjunto, proyecto o edificio al que pertenece un inmueble.
 *
 * "Reserva de la Loma" no es un inmueble, es el sitio donde estan veinte
 * apartamentos que solo se diferencian en metros, piso y precio. Sin esta
 * capa cada uno es una ficha suelta y el comprador no puede comparar las
 * tipologias de un mismo proyecto — que es justo como se decide una compra
 * de obra nueva.
 *
 * Es un arbol: un conjunto puede tener etapas o torres, y cada una sus
 * inmuebles. TypeORM lo materializa con una tabla de closure.
 */
@Entity('property_family')
@Tree('closure-table')
@Index(['cityId', 'status'])
export class PropertyFamily extends BaseEntity {
  @ApiProperty({ example: 'Reserva de la Loma' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Identificador legible para la web publica. */
  @ApiProperty({ example: 'reserva-de-la-loma' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 220 })
  slug: string;

  @ApiProperty({ enum: FamilyKind })
  @Column({ type: 'enum', enum: FamilyKind, default: FamilyKind.COMPLEX })
  kind: FamilyKind;

  @ApiProperty({ enum: FamilyStatus })
  @Column({ type: 'enum', enum: FamilyStatus, default: FamilyStatus.DELIVERED })
  status: FamilyStatus;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Constructora o promotora',
  })
  @Column({ type: 'varchar', length: 200, nullable: true })
  developer: string | null;

  // --- ubicacion ---------------------------------------------------------

  @ManyToOne(() => City, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'city_id' })
  city: City | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'city_id', type: 'int', nullable: true })
  cityId: number | null;

  @ManyToOne(() => Zone, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'zone_id', type: 'int', nullable: true })
  zoneId: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  latitude: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  longitude: string | null;

  // --- datos del proyecto ------------------------------------------------

  @ApiPropertyOptional({ nullable: true, description: 'Ano de entrega' })
  @Column({ type: 'smallint', nullable: true })
  deliveryYear: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Total de unidades del proyecto',
  })
  @Column({ type: 'smallint', nullable: true })
  totalUnits: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Imagen de portada del proyecto',
  })
  @Column({ type: 'text', nullable: true })
  coverUrl: string | null;

  @ApiProperty({ description: 'Visible en la web publica' })
  @Column({ type: 'boolean', default: true })
  published: boolean;

  // --- jerarquia ---------------------------------------------------------

  @TreeParent({ onDelete: 'SET NULL' })
  parent: PropertyFamily | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @TreeChildren()
  children: PropertyFamily[];

  @OneToMany('Property', 'family')
  properties: unknown[];
}
