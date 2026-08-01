import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export enum ConsignmentStatus {
  NEW = 'NEW',
  REVIEWING = 'REVIEWING',
  VISIT_SCHEDULED = 'VISIT_SCHEDULED',
  /** Se convirtio en un inmueble del inventario. */
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum ConsignmentCondition {
  ORIGINAL = 'ORIGINAL',
  TO_REMODEL = 'TO_REMODEL',
  REMODELED = 'REMODELED',
  BRAND_NEW = 'BRAND_NEW',
  SHELL = 'SHELL',
  BLUEPRINT = 'BLUEPRINT',
}

export enum CreditType {
  MORTGAGE = 'MORTGAGE',
  LEASING = 'LEASING',
  DEBT_FREE = 'DEBT_FREE',
}

export enum OccupancyStatus {
  RENTED = 'RENTED',
  VACANT = 'VACANT',
  OWNER_OCCUPIED = 'OWNER_OCCUPIED',
}

export enum ViewOrientation {
  NORTH = 'NORTH',
  SOUTH = 'SOUTH',
  EAST = 'EAST',
  WEST = 'WEST',
}

/** Documento o foto adjunta a la solicitud. */
export interface ConsignmentFile {
  kind: 'DOCUMENT' | 'PHOTO';
  storageKey: string;
  url: string;
  originalName: string;
  bytes: number;
}

/**
 * Solicitud de consignacion: un propietario que ofrece su inmueble.
 *
 * Sustituye al formulario de Google que la agencia venia usando. La diferencia
 * no es el formulario sino lo que pasa despues: aqui la solicitud entra en una
 * bandeja, se revisa, se agenda la visita y — si se acepta — se convierte en un
 * inmueble del inventario sin volver a teclear nada.
 *
 * Deliberadamente no es un `Property`: hasta que alguien la valide son datos
 * sin verificar de un tercero, y mezclarlos con el inventario real ensuciaria
 * todo lo que se publica y se reporta.
 */
@Entity('consignment_request')
@Index(['status', 'createdAt'])
export class ConsignmentRequest extends BaseEntity {
  @ApiProperty({
    description: 'Codigo visible para el propietario',
    example: 'SC-000148',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20 })
  reference: string;

  @ApiProperty({ enum: ConsignmentStatus })
  @Column({
    type: 'enum',
    enum: ConsignmentStatus,
    default: ConsignmentStatus.NEW,
  })
  status: ConsignmentStatus;

  // --- ubicacion ---------------------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'city_id', type: 'int', nullable: true })
  cityId: number | null;

  @ApiProperty({
    description: 'Texto libre: el propietario no conoce nuestro catalogo',
  })
  @Column({ type: 'varchar', length: 160 })
  cityName: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true })
  commune: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  neighborhood: string;

  @ApiProperty({ description: 'Nombre del conjunto o edificio' })
  @Column({ type: 'varchar', length: 200 })
  complexName: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 300 })
  address: string;

  @ApiProperty({ description: 'Numero de apartamento, casa o local' })
  @Column({ type: 'varchar', length: 60 })
  unitNumber: string;

  @ApiProperty({ minimum: 1, maximum: 6 })
  @Column({ type: 'smallint' })
  stratum: number;

  // --- caracteristicas ---------------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'property_type_id', type: 'int', nullable: true })
  propertyTypeId: number | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 80 })
  propertyTypeName: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  floor: string | null;

  @ApiPropertyOptional({ enum: ViewOrientation, nullable: true })
  @Column({ type: 'enum', enum: ViewOrientation, nullable: true })
  view: ViewOrientation | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  hasElevator: boolean;

  @ApiProperty({ enum: ConsignmentCondition })
  @Column({ type: 'enum', enum: ConsignmentCondition })
  condition: ConsignmentCondition;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  privateArea: string | null;

  @ApiProperty()
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  builtArea: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  lotArea: string | null;

  @ApiProperty()
  @Column({ type: 'smallint' })
  bedrooms: number;

  @ApiProperty()
  @Column({ type: 'smallint' })
  bathrooms: number;

  @ApiProperty()
  @Column({ type: 'smallint' })
  parkingSpaces: number;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  hasStorageRoom: boolean;

  @ApiProperty()
  @Column({ type: 'smallint' })
  buildingYear: number;

  /** Zona social: ids del catalogo de caracteristicas. */
  @ApiProperty({ type: [Number] })
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  amenityIds: number[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'La opcion "Otro" del formulario',
  })
  @Column({ type: 'varchar', length: 300, nullable: true })
  amenitiesOther: string | null;

  // --- dinero ------------------------------------------------------------

  @ApiProperty()
  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0 })
  maintenanceFee: string;

  @ApiProperty()
  @Column({ type: 'numeric', precision: 16, scale: 2 })
  salePrice: string;

  @ApiProperty({ enum: CreditType })
  @Column({ type: 'enum', enum: CreditType })
  creditType: CreditType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Banco o entidad del credito',
  })
  @Column({ type: 'varchar', length: 160, nullable: true })
  creditInstitution: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  debtAmount: string | null;

  // --- ocupacion ---------------------------------------------------------

  @ApiProperty({ enum: OccupancyStatus })
  @Column({ type: 'enum', enum: OccupancyStatus })
  occupancy: OccupancyStatus;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  rentAmount: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Fin del contrato de arriendo',
  })
  @Column({ type: 'date', nullable: true })
  leaseEndsOn: string | null;

  // --- propietario -------------------------------------------------------

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  ownerFirstName: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  ownerLastName: string;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 180 })
  ownerEmail: string;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 40 })
  ownerPhone: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // --- adjuntos y visita -------------------------------------------------

  @ApiProperty({
    description: 'Escrituras, certificado de tradicion, recibos y fotos',
  })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  files: ConsignmentFile[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Franja que pidio el propietario',
  })
  @Column({ type: 'timestamptz', nullable: true })
  requestedVisitAt: Date | null;

  // --- gestion interna ---------------------------------------------------

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cita creada al aceptar la visita',
  })
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Inmueble creado al aceptarla',
  })
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cliente creado para el propietario',
  })
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'reviewed_by_agent_id', type: 'uuid', nullable: true })
  reviewedByAgentId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Motivo del rechazo' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;

  /** Trazabilidad de quien envio el formulario. */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  submittedFromIp: string | null;
}
