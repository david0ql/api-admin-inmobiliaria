import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBooleanString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../shared/http/dto/page-query.dto';
import { csvNumbers, csvStrings } from '../../../shared/http/query-params';
import {
  Availability,
  PropertyCondition,
  PublicationStatus,
} from '../domain/property.enums';

export enum PropertySort {
  RECENT = 'recent',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  AREA_DESC = 'area_desc',
  VISITS_DESC = 'visits_desc',
}

export class SearchPropertiesDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Texto libre sobre titulo, direccion y codigo',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(csvNumbers)
  @IsArray()
  @IsInt({ each: true })
  cityId?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(csvNumbers)
  @IsArray()
  @IsInt({ each: true })
  zoneId?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(csvNumbers)
  @IsArray()
  @IsInt({ each: true })
  propertyTypeId?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'El inmueble debe tenerlas TODAS',
  })
  @IsOptional()
  @Transform(csvNumbers)
  @IsArray()
  @IsInt({ each: true })
  featureId?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxArea?: number;

  @ApiPropertyOptional({ description: 'Minimo de alcobas' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  bedrooms?: number;

  @ApiPropertyOptional({ description: 'Minimo de banos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  bathrooms?: number;

  @ApiPropertyOptional({ description: 'Minimo de garajes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  garages?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  stratum?: number;

  @ApiPropertyOptional({ enum: Availability, isArray: true })
  @IsOptional()
  @Transform(csvStrings)
  @IsEnum(Availability, { each: true })
  availability?: Availability[];

  @ApiPropertyOptional({ enum: PublicationStatus, isArray: true })
  @IsOptional()
  @Transform(csvStrings)
  @IsEnum(PublicationStatus, { each: true })
  publicationStatus?: PublicationStatus[];

  @ApiPropertyOptional({ enum: PropertyCondition })
  @IsOptional()
  @IsEnum(PropertyCondition)
  condition?: PropertyCondition;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  labelId?: string;

  @ApiPropertyOptional({ description: 'true = solo en venta' })
  @IsOptional()
  @IsBooleanString()
  forSale?: string;

  @ApiPropertyOptional({ description: 'true = solo en arriendo' })
  @IsOptional()
  @IsBooleanString()
  forRent?: string;

  @ApiPropertyOptional({ description: 'true = solo con video' })
  @IsOptional()
  @IsBooleanString()
  hasVideo?: string;

  @ApiPropertyOptional({ description: 'true = solo con recorrido 360' })
  @IsOptional()
  @IsBooleanString()
  hasTour?: string;

  @ApiPropertyOptional({
    description: 'Caja geografica: minLng,minLat,maxLng,maxLat',
    example: '-73.2,7.0,-73.0,7.2',
  })
  @IsOptional()
  @IsString()
  bbox?: string;

  @ApiPropertyOptional({ enum: PropertySort, default: PropertySort.RECENT })
  @IsOptional()
  @IsEnum(PropertySort)
  sort?: PropertySort;
}
