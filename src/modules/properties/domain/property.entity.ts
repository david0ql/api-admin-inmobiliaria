import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { numericTransformer } from '../../../shared/database/transformers';
import { Agent } from '../../iam/domain/agent.entity';
import { City, Zone } from '../../catalog/domain/geography.entity';
import {
  Currency,
  Feature,
  PropertyType,
} from '../../catalog/domain/catalogs.entity';
import { PropertyImage } from './property-image.entity';
import { PropertyLabel } from './property-label.entity';
import { PropertyFamily } from './property-family.entity';
import {
  Availability,
  MapPublication,
  PropertyCondition,
  PublicationStatus,
  RentPeriod,
} from './property.enums';

/**
 * Inmueble.
 *
 * Solo se modelan campos con datos reales en los 642 inmuebles del volcado. Se
 * omiten los que WASI expone pero la agencia nunca uso: `id_location`,
 * `featured`, `tv_share`, `half_bathrooms`, `reference`, `zip_code`,
 * `registration_number` y `comment` (0 % de relleno en los 642).
 *
 * Los campos de arriendo se conservan aunque hoy los 642 esten marcados solo
 * como venta: 83 llevan la etiqueta "Alquilado", de modo que el arriendo existe
 * en la operacion aunque no estuviera registrado como tal.
 */
@Entity('property')
@Index(['availability', 'publicationStatus'])
@Index(['cityId', 'zoneId'])
@Index(['salePrice'])
@Index(['latitude', 'longitude'])
export class Property extends BaseEntity {
  @ApiPropertyOptional({ description: 'id_property original en WASI' })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ApiProperty({
    description: 'Codigo visible al cliente',
    example: '10232957',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 300 })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ficha en la web publica',
  })
  @Column({ type: 'text', nullable: true })
  publicUrl: string | null;

  // --- tipo de negocio ---------------------------------------------------

  @ApiProperty()
  @Index()
  @Column({ type: 'boolean', default: false })
  forSale: boolean;

  @ApiProperty()
  @Index()
  @Column({ type: 'boolean', default: false })
  forRent: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  forTransfer: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  forTemporaryRent: boolean;

  // --- precios -----------------------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 16,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  salePrice: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 16,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  rentPrice: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cuota de administracion',
  })
  @Column({
    type: 'numeric',
    precision: 16,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  maintenanceFee: number | null;

  @ApiPropertyOptional({ enum: RentPeriod, nullable: true })
  @Column({ type: 'enum', enum: RentPeriod, nullable: true })
  rentPeriod: RentPeriod | null;

  @ManyToOne(() => Currency, { nullable: false, eager: true })
  @JoinColumn({ name: 'currency_id' })
  currency: Currency;

  @ApiProperty()
  @Column({ name: 'currency_id', type: 'int' })
  currencyId: number;

  // --- clasificacion y ubicacion ----------------------------------------

  @ManyToOne(() => PropertyType, { nullable: false, eager: true })
  @JoinColumn({ name: 'property_type_id' })
  propertyType: PropertyType;

  @ApiProperty()
  @Index()
  @Column({ name: 'property_type_id', type: 'int' })
  propertyTypeId: number;

  @ManyToOne(() => City, { nullable: false, eager: true })
  @JoinColumn({ name: 'city_id' })
  city: City;

  @ApiProperty()
  @Column({ name: 'city_id', type: 'int' })
  cityId: number;

  @ManyToOne(() => Zone, { nullable: true, eager: true })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'zone_id', type: 'int', nullable: true })
  zoneId: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: numericTransformer,
  })
  latitude: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: numericTransformer,
  })
  longitude: number | null;

  @ApiProperty({ enum: MapPublication })
  @Column({
    type: 'enum',
    enum: MapPublication,
    default: MapPublication.APPROXIMATE,
  })
  mapPublication: MapPublication;

  // --- caracteristicas fisicas ------------------------------------------

  @ApiPropertyOptional({ nullable: true, description: 'Area total en m2' })
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  area: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  builtArea: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  privateArea: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bedrooms: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bathrooms: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  garages: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'smallint', nullable: true })
  floor: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Estrato socioeconomico (1-6)',
  })
  @Column({ type: 'smallint', nullable: true })
  stratum: number | null;

  @ApiPropertyOptional({ enum: PropertyCondition, nullable: true })
  @Column({ type: 'enum', enum: PropertyCondition, nullable: true })
  condition: PropertyCondition | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ano de construccion' })
  @Column({ type: 'smallint', nullable: true })
  buildingYear: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  observations: string | null;

  /**
   * Lo mismo, en ingles.
   *
   * Va en su propia columna y no en la tabla de traducciones porque no es una
   * frase de la web: es texto libre que escribio un asesor sobre ESTE inmueble
   * —"la terraza da al parque"— y hay uno distinto por ficha. Un diccionario de
   * claves no puede con seiscientos textos irrepetibles.
   *
   * Vacio, la web en ingles no enseña nada en su lugar. Enseñar el español
   * seria justo lo que se quiere evitar, y la descripcion automatica ya cuenta
   * los datos del inmueble en ingles.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'observations_en', type: 'text', nullable: true })
  observationsEn: string | null;

  // --- estado ------------------------------------------------------------

  @ApiProperty({ enum: Availability })
  @Column({ type: 'enum', enum: Availability, default: Availability.AVAILABLE })
  availability: Availability;

  @ApiProperty({ enum: PublicationStatus })
  @Column({
    type: 'enum',
    enum: PublicationStatus,
    default: PublicationStatus.DRAFT,
  })
  publicationStatus: PublicationStatus;

  @ManyToOne(() => PropertyLabel, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'label_id' })
  label: PropertyLabel | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'label_id', type: 'uuid', nullable: true })
  labelId: string | null;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  visits: number;

  // --- multimedia --------------------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  videoUrl: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Recorrido 360 (Kuula)' })
  @Column({ type: 'text', nullable: true })
  tourUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'id_gallery de WASI, para trazabilidad',
  })
  @Column({ type: 'int', nullable: true })
  wasiGalleryId: number | null;

  @OneToMany(() => PropertyImage, (img) => img.property, {
    cascade: ['insert'],
  })
  images: PropertyImage[];

  // --- proyecto al que pertenece -----------------------------------------

  /**
   * Conjunto, edificio o proyecto del que forma parte. Nulo para los inmuebles
   * sueltos, que son la mayoria del inventario de segunda mano.
   */
  @ManyToOne(() => PropertyFamily, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'family_id' })
  family: PropertyFamily | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'family_id', type: 'uuid', nullable: true })
  familyId: string | null;

  /** Nombre de la tipologia dentro del proyecto: "Tipo A", "Esquinero". */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true })
  unitType: string | null;

  // --- responsable -------------------------------------------------------

  @ManyToOne(() => Agent, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_agent_id' })
  assignedAgent: Agent | null;

  @ApiPropertyOptional({ nullable: true })
  @Index()
  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assignedAgentId: string | null;

  // --- sede --------------------------------------------------------------

  /**
   * La oficina que lleva el inmueble. Obligatoria.
   *
   * Sin sede el inmueble no aparece en ningun panel acotado —ni en el de su
   * propia oficina— y se convierte en inventario invisible: por eso la columna
   * es NOT NULL en base y aqui no se declara nullable. No se modela la relacion
   * con `Branch`: para filtrar basta la clave, y una relacion eager mas
   * multiplicaria los joins de todos los listados.
   */
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  // --- caracteristicas ---------------------------------------------------

  @ManyToMany(() => Feature)
  @JoinTable({
    name: 'property_feature',
    joinColumn: { name: 'property_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'feature_id', referencedColumnName: 'id' },
  })
  features: Feature[];

  /**
   * Columna generada para la busqueda por texto. Al ser STORED, Postgres la
   * mantiene sola y el indice GIN trigram sobre ella permite buscar por titulo,
   * direccion o codigo con una sola condicion.
   */
  @Column({
    type: 'text',
    generatedType: 'STORED',
    asExpression: `lower(coalesce(title,'') || ' ' || coalesce(address,'') || ' ' || coalesce(code,''))`,
    select: false,
    nullable: true,
  })
  searchText: string;
}
