import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { PropertyFamily } from './property-family.entity';
import type { UnitTypeImage } from './unit-type-image.entity';

export enum UnitTypeKind {
  /** La escribe la agencia: "Tipo A, 2 alcobas, 58 m²". Manda ella. */
  FIXED = 'FIXED',
  /**
   * La pone el sistema por tramo de area. Es para suelo —lotes, terrenos,
   * fincas— donde no hay dos iguales: agrupar por alcobas no sirve porque no
   * tienen, y escribir una tipologia por lote seria una por inmueble.
   */
  AUTO = 'AUTO',
}

/**
 * Una tipología de un proyecto: el "Tipo A" del que hay veinte iguales.
 *
 * Hasta ahora esto no existía como tabla. Se calculaba al vuelo agrupando por
 * un campo de texto —`property.unit_type`— que está vacío en los 642
 * inmuebles, y por eso la ficha de proyecto decía "Sin clasificar" en todas
 * partes: se agrupaba por nada.
 *
 * Calcularlas tiene un problema de fondo: dos apartamentos de 58 m² con 3
 * alcobas caen en el mismo grupo aunque uno mire al parque y el otro a la
 * medianera, y la agencia no puede decir lo contrario. Al ser tabla, la
 * tipología es una decisión de la agencia y no una consecuencia de los datos.
 */
@Entity('unit_type')
@Unique('UQ_unit_type_family_code', ['familyId', 'code'])
@Index(['familyId'])
export class UnitType extends BaseEntity {
  @ApiProperty()
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @ManyToOne(() => PropertyFamily, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'family_id' })
  family?: PropertyFamily;

  /** Corto y unico dentro del proyecto: "A", "B", "L1". */
  @ApiProperty({ example: 'A' })
  @Column({ type: 'varchar', length: 8 })
  code: string;

  @ApiProperty({ example: 'Tipo A · 2 alcobas · 58 m²' })
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ enum: UnitTypeKind })
  @Column({ type: 'enum', enum: UnitTypeKind, default: UnitTypeKind.FIXED })
  kind: UnitTypeKind;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bedrooms: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bathrooms: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  garages: number | null;

  /*
    El area va como rango y no como cifra unica porque una tipologia real no es
    exacta: el "Tipo A" de un edificio mide 58 m² en el segundo piso y 58,4 en
    el octavo. Para suelo, el rango ES la tipologia.
  */
  /*
    LA ECONOMIA DE LA TIPOLOGIA, cuando se escribe a mano.

    Para vender obra nueva no se dan de alta las 120 fichas de inmueble de una
    torre: se anuncian cuatro tipologias con su precio y sus unidades. Estas
    columnas son lo que permite que un proyecto exista y se venda sin inventar
    inmuebles.

    Manda lo escrito, igual que con las areas: solo si no hay nada aqui se cae
    a lo que digan las unidades dadas de alta. Por eso los conjuntos de hoy
    —que no tienen nada escrito— siguen comportandose exactamente igual.
  */
  @ApiPropertyOptional({ nullable: true, description: 'Precio desde, escrito a mano' })
  @Column({
    name: 'price_from',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  priceFrom: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'price_to',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  priceTo: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Cuántas unidades tiene esta tipología' })
  @Column({ name: 'units_total', type: 'int', nullable: true })
  unitsTotal: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Cuántas quedan por vender' })
  @Column({ name: 'units_available', type: 'int', nullable: true })
  unitsAvailable: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'area_min',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  areaMin: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'area_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  areaMax: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    name: 'built_area',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  builtArea: string | null;

  /** El orden en que la agencia quiere enseñarlas. */
  @ApiProperty()
  @Column({ type: 'smallint', default: 0 })
  position: number;

  /** Sus planos y sus fotos. Solo viaja cuando quien pregunta la pide. */
  @OneToMany('UnitTypeImage', 'unitType')
  images?: UnitTypeImage[];
}
