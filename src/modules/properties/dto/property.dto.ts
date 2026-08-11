import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  Availability,
  MapPublication,
  PropertyCondition,
  PublicationStatus,
  RentPeriod,
} from '../domain/property.enums';

export class CreatePropertyDto {
  @ApiPropertyOptional({ description: 'Se genera solo si se omite' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  code?: string;

  @ApiProperty()
  @IsString()
  @Length(5, 300)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  forSale?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forRent?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forTransfer?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forTemporaryRent?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((o: CreatePropertyDto) => o.forSale !== false)
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreatePropertyDto) => o.forRent === true || o.forTemporaryRent === true,
  )
  @IsNumber()
  @Min(0)
  rentPrice?: number;

  @ApiPropertyOptional({ enum: RentPeriod })
  @IsOptional()
  @IsEnum(RentPeriod)
  rentPeriod?: RentPeriod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maintenanceFee?: number;

  @ApiProperty({ example: 1, description: 'COP = 1' })
  @IsInt()
  currencyId: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  propertyTypeId: number;

  @ApiProperty({ example: 105 })
  @IsInt()
  cityId: number;

  @ApiPropertyOptional({ example: 388533 })
  @IsOptional()
  @IsInt()
  zoneId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ enum: MapPublication })
  @IsOptional()
  @IsEnum(MapPublication)
  mapPublication?: MapPublication;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  area?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  builtArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  privateArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  bathrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  garages?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(-5)
  @Max(200)
  floor?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  stratum?: number;

  @ApiPropertyOptional({ enum: PropertyCondition })
  @IsOptional()
  @IsEnum(PropertyCondition)
  condition?: PropertyCondition;

  @ApiPropertyOptional({ example: 2015 })
  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  buildingYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observations?: string;

  @ApiPropertyOptional({ description: 'La descripcion del asesor, en ingles.' })
  @IsOptional()
  @IsString()
  observationsEn?: string;

  @ApiPropertyOptional({ enum: Availability })
  @IsOptional()
  @IsEnum(Availability)
  availability?: Availability;

  @ApiPropertyOptional({ enum: PublicationStatus })
  @IsOptional()
  @IsEnum(PublicationStatus)
  publicationStatus?: PublicationStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  labelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @ApiPropertyOptional({ description: 'Recorrido virtual 360' })
  @IsOptional()
  @IsUrl()
  tourUrl?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, quien lo crea',
  })
  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Ids del catalogo de caracteristicas',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(140)
  @Type(() => Number)
  @IsInt({ each: true })
  featureIds?: number[];
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class AssignPropertyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

export class ReorderImagesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Ids en el orden deseado',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  imageIds: string[];
}
