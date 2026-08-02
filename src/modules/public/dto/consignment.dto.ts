import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  ConsignmentCondition,
  ConsignmentStatus,
  CreditType,
  OccupancyStatus,
  ViewOrientation,
} from '../domain/consignment-request.entity';

/**
 * En `multipart/form-data` no existen los tipos: todo llega como texto. El
 * formulario publico envia ficheros, asi que los numeros y booleanos se
 * convierten aqui — el DTO tiene que aceptar los dos transportes que declara.
 */
const asNumber = () =>
  Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  );
const asBool = () =>
  Transform(({ value }) =>
    typeof value === 'boolean'
      ? value
      : ['true', '1', 'si', 'sí', 'on'].includes(String(value).toLowerCase()),
  );

/**
 * Solicitud de consignacion enviada desde la web publica.
 *
 * Reproduce el formulario que la agencia tenia en Google, con dos diferencias:
 * los desplegables viajan como enum en vez de texto suelto — asi "Remodelado" y
 * "remodelado " dejan de ser dos cosas distintas — y los ids de catalogo son
 * opcionales, porque el propietario escribe su ciudad, no la elige de nuestra
 * tabla.
 */
export class CreateConsignmentDto {
  // --- ubicacion ---------------------------------------------------------

  @ApiProperty({ example: 'Bucaramanga' })
  @IsString()
  @Length(2, 160)
  cityName: string;

  @ApiPropertyOptional({
    description: 'Id de nuestro catalogo, si la web lo resuelve',
  })
  @IsOptional()
  @IsInt()
  @asNumber()
  cityId?: number;

  @ApiPropertyOptional({ example: 'Comuna 12' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  commune?: string;

  @ApiProperty({ example: 'Cañaveral' })
  @IsString()
  @Length(2, 160)
  neighborhood: string;

  @ApiProperty({ example: 'Reserva de la Loma' })
  @IsString()
  @Length(2, 200)
  complexName: string;

  @ApiProperty({ example: 'Carrera 31 #121-29' })
  @IsString()
  @Length(3, 300)
  address: string;

  @ApiProperty({ example: '502' })
  @IsString()
  @Length(1, 60)
  unitNumber: string;

  @ApiProperty({ minimum: 1, maximum: 6 })
  @IsInt()
  @Min(1)
  @Max(6)
  @asNumber()
  stratum: number;

  // --- caracteristicas ---------------------------------------------------

  @ApiProperty({ example: 'Apartamento' })
  @IsString()
  @Length(2, 80)
  propertyTypeName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @asNumber()
  propertyTypeId?: number;

  @ApiPropertyOptional({ example: '5' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  floor?: string;

  @ApiPropertyOptional({ enum: ViewOrientation })
  @IsOptional()
  @IsEnum(ViewOrientation)
  view?: ViewOrientation;

  @ApiProperty()
  @IsBoolean()
  @asBool()
  hasElevator: boolean;

  @ApiProperty({ enum: ConsignmentCondition })
  @IsEnum(ConsignmentCondition)
  condition: ConsignmentCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  privateArea?: number;

  @ApiProperty({ description: 'Area construida en m²' })
  @IsNumber()
  @Min(1)
  @asNumber()
  builtArea: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  lotArea?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(99)
  @asNumber()
  bedrooms: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(99)
  @asNumber()
  bathrooms: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(99)
  @asNumber()
  parkingSpaces: number;

  @ApiProperty()
  @IsBoolean()
  @asBool()
  hasStorageRoom: boolean;

  @ApiProperty({ example: 2015 })
  @IsInt()
  @Min(1800)
  @Max(2100)
  @asNumber()
  buildingYear: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Zona social: ids del catalogo',
  })
  @IsOptional()
  /*
   * En `multipart/form-data` no hay listas: un campo repetido llega como array,
   * pero uno solo llega como cadena. Sin esto, marcar una unica casilla de la
   * zona social tumbaba el envio entero con "amenityIds must be an array".
   */
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    const list = Array.isArray(value) ? value : [value];
    return list.map(Number);
  })
  @IsArray()
  @ArrayMaxSize(60)
  @IsInt({ each: true })
  amenityIds?: number[];

  @ApiPropertyOptional({ description: 'La opcion "Otro"' })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  amenitiesOther?: string;

  // --- dinero ------------------------------------------------------------

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @asNumber()
  maintenanceFee: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @asNumber()
  salePrice: number;

  @ApiProperty({ enum: CreditType })
  @IsEnum(CreditType)
  creditType: CreditType;

  @ApiPropertyOptional({ description: 'Banco o entidad' })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  creditInstitution?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  debtAmount?: number;

  // --- ocupacion ---------------------------------------------------------

  @ApiProperty({ enum: OccupancyStatus })
  @IsEnum(OccupancyStatus)
  occupancy: OccupancyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  rentAmount?: number;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  leaseEndsOn?: string;

  // --- propietario -------------------------------------------------------

  @ApiProperty()
  @IsString()
  @Length(1, 160)
  ownerFirstName: string;

  @ApiProperty()
  @IsString()
  @Length(1, 160)
  ownerLastName: string;

  @ApiProperty()
  @IsEmail()
  ownerEmail: string;

  @ApiProperty({ example: '+57 300 000 0000' })
  @IsString()
  @Length(6, 40)
  ownerPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  // --- visita ------------------------------------------------------------

  @ApiPropertyOptional({
    description: 'Franja elegida en el calendario de disponibilidad, en ISO',
    example: '2026-08-06T15:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  requestedVisitAt?: string;

  /**
   * Token del captcha. La web publica lo adjunta; la API lo verifica antes de
   * aceptar nada, porque un formulario abierto sin esto se llena de basura en
   * cuestion de dias.
   */
  @ApiPropertyOptional({ description: 'Token del captcha de la web publica' })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class ReviewConsignmentDto {
  @ApiProperty({ enum: ConsignmentStatus })
  @IsEnum(ConsignmentStatus)
  status: ConsignmentStatus;

  @ApiPropertyOptional({ description: 'Motivo, sobre todo si se rechaza' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  resolution?: string;
}

export class SearchConsignmentsDto {
  @ApiPropertyOptional({ enum: ConsignmentStatus })
  @IsOptional()
  @IsEnum(ConsignmentStatus)
  status?: ConsignmentStatus;

  @ApiPropertyOptional({
    description: 'Nombre, correo, telefono, direccion o referencia',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class BookVisitDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  propertyId: string;

  @ApiProperty({ example: '2026-08-06T15:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty()
  @IsString()
  @Length(1, 160)
  firstName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  lastName?: string;

  @ApiProperty()
  @IsString()
  @Length(6, 40)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Lo que quiera contar el interesado' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  message?: string;

  @ApiPropertyOptional({ description: 'Token del captcha de la web publica' })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
