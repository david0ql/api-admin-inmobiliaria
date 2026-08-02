import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export enum CreditRequestStatus {
  NEW = 'NEW',
  REVIEWING = 'REVIEWING',
  /** Radicada ante la entidad financiera. */
  SUBMITTED = 'SUBMITTED',
  PREAPPROVED = 'PREAPPROVED',
  REJECTED = 'REJECTED',
  /** El interesado desistio o dejo de responder. */
  DROPPED = 'DROPPED',
}

export enum DocumentType {
  CC = 'CC',
  CE = 'CE',
  PASSPORT = 'PASSPORT',
  NIT = 'NIT',
}

export enum Gender {
  FEMALE = 'FEMALE',
  MALE = 'MALE',
  OTHER = 'OTHER',
  UNDISCLOSED = 'UNDISCLOSED',
}

export enum OccupationType {
  SALARIED = 'SALARIED',
  PENSIONER = 'PENSIONER',
  SELF_EMPLOYED = 'SELF_EMPLOYED',
}

/** VIS y No VIS: el tramo de precio decide subsidio, tasa y tope de plazo. */
export enum PortfolioType {
  VIS = 'VIS',
  NON_VIS = 'NON_VIS',
}

export enum HousingType {
  NEW = 'NEW',
  USED = 'USED',
}

export enum CreditProduct {
  MORTGAGE = 'MORTGAGE',
  HOUSING_LEASING = 'HOUSING_LEASING',
}

/**
 * El segundo solicitante.
 *
 * Va en `jsonb` y no en su propia tabla a proposito: no se consulta por el, no
 * se le asigna asesor y no vive mas alla de la solicitud que lo trajo. Una
 * tabla con clave ajena obligaria a un join en cada listado para enseñar un
 * dato que solo se mira al abrir el detalle.
 */
export interface CoApplicant {
  firstName: string;
  lastName: string;
  birthDate: string;
  phone: string;
  email: string;
  documentType: DocumentType;
  documentNumber: string;
  gender: Gender | null;
  occupation: OccupationType;
  monthlyIncome: string | null;
}

/**
 * Consulta de viabilidad de credito hipotecario.
 *
 * Es un lead, no un tramite: aqui no se aprueba nada ni se habla con ningun
 * banco. Se recoge lo que la entidad va a pedir de todas formas para que el
 * asesor llame con el caso ya armado, y se guarda junto al inmueble que motivo
 * la consulta cuando lo hay — que es la mitad de la conversacion.
 *
 * Deliberadamente separada de `Client`: hasta que alguien la revise son datos
 * sin verificar, y meterlos en la cartera ensuciaria el embudo. Al pasarla a
 * REVIEWING el asesor decide si nace el cliente.
 */
@Entity('credit_request')
@Index(['status', 'createdAt'])
export class CreditRequest extends BaseEntity {
  @ApiProperty({
    description: 'Codigo visible para el solicitante',
    example: 'CR-000148',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20 })
  reference: string;

  @ApiProperty({ enum: CreditRequestStatus })
  @Column({
    type: 'enum',
    enum: CreditRequestStatus,
    default: CreditRequestStatus.NEW,
  })
  status: CreditRequestStatus;

  // --- solicitante -------------------------------------------------------

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  firstName: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 160 })
  lastName: string;

  @ApiProperty({ description: 'Decide la edad al vencimiento del credito' })
  @Column({ type: 'date' })
  birthDate: string;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 180 })
  email: string;

  @ApiProperty({ enum: DocumentType })
  @Column({ type: 'enum', enum: DocumentType })
  documentType: DocumentType;

  @ApiProperty()
  @Column({ type: 'varchar', length: 40 })
  documentNumber: string;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender | null;

  // --- ingresos ----------------------------------------------------------

  @ApiProperty({ enum: OccupationType })
  @Column({ type: 'enum', enum: OccupationType })
  occupation: OccupationType;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  monthlyIncome: string | null;

  // --- credito -----------------------------------------------------------

  @ApiProperty({ enum: PortfolioType })
  @Column({ type: 'enum', enum: PortfolioType })
  portfolioType: PortfolioType;

  @ApiProperty({ enum: HousingType })
  @Column({ type: 'enum', enum: HousingType })
  housingType: HousingType;

  @ApiProperty({ enum: CreditProduct })
  @Column({ type: 'enum', enum: CreditProduct })
  product: CreditProduct;

  @ApiProperty({ description: 'Plazo en años', example: 25 })
  @Column({ type: 'smallint' })
  termYears: number;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'work_city_id', type: 'int', nullable: true })
  workCityId: number | null;

  @ApiProperty({ description: 'Ciudad donde trabaja, tal y como la escribio' })
  @Column({ type: 'varchar', length: 160 })
  workCityName: string;

  @ApiProperty({ description: 'Monto solicitado' })
  @Column({ type: 'numeric', precision: 16, scale: 2 })
  amount: string;

  // --- inmueble ----------------------------------------------------------

  @ApiProperty({ description: 'Si ya sabe cual quiere comprar' })
  @Column({ type: 'boolean', default: false })
  hasPropertyPicked: boolean;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  propertyValue: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Codigo del inmueble de la agencia, si la consulta salio de su ficha',
  })
  @Column({ type: 'varchar', length: 40, nullable: true })
  propertyCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId: string | null;

  // --- segundo solicitante -----------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  coApplicant: CoApplicant | null;

  // --- rastro ------------------------------------------------------------

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ApiProperty({
    description: 'Cuando acepto el tratamiento de datos. Sin esto no se envia.',
  })
  @Column({ type: 'timestamptz' })
  acceptedTermsAt: Date;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  submittedFromIp: string | null;

  // --- gestion interna ---------------------------------------------------

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cliente creado al tomar la solicitud',
  })
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assignedAgentId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'reviewed_by_agent_id', type: 'uuid', nullable: true })
  reviewedByAgentId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Entidad a la que se radico',
  })
  @Column({ type: 'varchar', length: 160, nullable: true })
  institution: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Motivo o siguiente paso',
  })
  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;
}
