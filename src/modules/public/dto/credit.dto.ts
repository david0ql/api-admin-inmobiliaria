import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CreditProduct,
  CreditRequestStatus,
  DocumentType,
  Gender,
  HousingType,
  OccupationType,
  PortfolioType,
} from '../domain/credit-request.entity';

const asNumber = () =>
  Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  );

/** Datos del segundo solicitante. Solo llegan si el visitante lo activo. */
export class CoApplicantDto {
  @ApiProperty()
  @IsString()
  @Length(2, 160)
  firstName: string;

  @ApiProperty()
  @IsString()
  @Length(2, 160)
  lastName: string;

  @ApiProperty({ example: '1988-04-17' })
  @IsDateString()
  birthDate: string;

  @ApiProperty()
  @IsString()
  @Length(6, 40)
  phone: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty()
  @IsString()
  @Length(4, 40)
  documentNumber: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ enum: OccupationType })
  @IsEnum(OccupationType)
  occupation: OccupationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  monthlyIncome?: number;
}

/**
 * Consulta de viabilidad enviada desde la web publica.
 *
 * Lo que en el formulario son dos casillas de confirmacion —repetir telefono y
 * documento— no viaja: comparar dos campos es trabajo del navegador, y aceptar
 * los dos aqui solo daria una forma mas de guardar el equivocado.
 */
export class CreateCreditRequestDto {
  // --- solicitante -------------------------------------------------------

  @ApiProperty()
  @IsString()
  @Length(2, 160)
  firstName: string;

  @ApiProperty()
  @IsString()
  @Length(2, 160)
  lastName: string;

  @ApiProperty({
    example: '1988-04-17',
    description: 'La edad al vencimiento decide si la operacion es viable',
  })
  @IsDateString()
  birthDate: string;

  @ApiProperty({ example: '+57 300 000 0000' })
  @IsString()
  @Length(6, 40)
  phone: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty()
  @IsString()
  @Length(4, 40)
  documentNumber: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  // --- ingresos ----------------------------------------------------------

  @ApiProperty({ enum: OccupationType })
  @IsEnum(OccupationType)
  occupation: OccupationType;

  @ApiPropertyOptional({ description: 'Ingreso mensual declarado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @asNumber()
  monthlyIncome?: number;

  // --- credito -----------------------------------------------------------

  @ApiProperty({ enum: PortfolioType })
  @IsEnum(PortfolioType)
  portfolioType: PortfolioType;

  @ApiProperty({ enum: HousingType })
  @IsEnum(HousingType)
  housingType: HousingType;

  @ApiProperty({ enum: CreditProduct })
  @IsEnum(CreditProduct)
  product: CreditProduct;

  @ApiProperty({ example: 25, description: 'Plazo en años' })
  @IsInt()
  @Min(1)
  @Max(30)
  @asNumber()
  termYears: number;

  @ApiProperty({ example: 'Bucaramanga' })
  @IsString()
  @Length(2, 160)
  workCityName: string;

  @ApiPropertyOptional({
    description: 'Id del catalogo, si la web lo resuelve',
  })
  @IsOptional()
  @IsInt()
  @asNumber()
  workCityId?: number;

  @ApiProperty({ description: 'Monto solicitado' })
  @IsNumber()
  @Min(1)
  @asNumber()
  amount: number;

  // --- inmueble ----------------------------------------------------------

  @ApiProperty()
  @IsBoolean()
  hasPropertyPicked: boolean;

  /** Si ya lo eligio, el valor deja de ser un dato de color: es el que manda. */
  @ApiPropertyOptional()
  @ValidateIf((dto: CreateCreditRequestDto) => dto.hasPropertyPicked)
  @IsNumber()
  @Min(1)
  @asNumber()
  propertyValue?: number;

  @ApiPropertyOptional({
    description: 'Codigo del inmueble de la agencia, si viene de su ficha',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  propertyCode?: string;

  // --- segundo solicitante -----------------------------------------------

  @ApiPropertyOptional({ type: CoApplicantDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoApplicantDto)
  coApplicant?: CoApplicantDto;

  // --- cierre ------------------------------------------------------------

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @ApiProperty({
    description:
      'Tratamiento de datos. Se exige `true`: sin consentimiento no hay dato que guardar.',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'Hay que aceptar el tratamiento de datos para enviar la consulta',
  })
  acceptedTerms: boolean;

  @ApiPropertyOptional({ description: 'Token del captcha de la web publica' })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class ReviewCreditRequestDto {
  @ApiProperty({ enum: CreditRequestStatus })
  @IsEnum(CreditRequestStatus)
  status: CreditRequestStatus;

  @ApiPropertyOptional({ description: 'Entidad a la que se radico' })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  institution?: string;

  @ApiPropertyOptional({ description: 'Motivo o siguiente paso' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  resolution?: string;
}

export class SearchCreditRequestsDto {
  @ApiPropertyOptional({ enum: CreditRequestStatus })
  @IsOptional()
  @IsEnum(CreditRequestStatus)
  status?: CreditRequestStatus;

  @ApiPropertyOptional({
    description: 'Nombre, correo, telefono, documento o referencia',
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
