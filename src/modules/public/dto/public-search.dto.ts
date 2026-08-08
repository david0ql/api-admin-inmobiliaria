import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PropertyCondition } from '../../properties/domain/property.enums';

export class SearchPublicPropertiesDto {
  @ApiPropertyOptional({
    description: 'Texto libre sobre título, dirección y código',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description:
      'Pais y departamento filtran de verdad, no solo alimentan el desplegable de ciudades: quien elige Santander sin elegir ciudad espera ver Santander entero.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  countryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  regionId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  zoneId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyTypeId?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Unidades de un proyecto concreto',
  })
  @IsOptional()
  @IsUUID()
  familyId?: string;

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

  @ApiPropertyOptional({ description: 'Mínimo de alcobas' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  bedrooms?: number;

  @ApiPropertyOptional({ description: 'Mínimo de baños' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  bathrooms?: number;

  @ApiPropertyOptional({ enum: PropertyCondition })
  @IsOptional()
  @IsEnum(PropertyCondition)
  condition?: PropertyCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  forSale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  forRent?: string;

  @ApiPropertyOptional({ description: 'Permuta' })
  @IsOptional()
  @IsBooleanString()
  forTransfer?: string;

  @ApiPropertyOptional({
    enum: ['recent', 'price_asc', 'price_desc', 'area_desc'],
  })
  @IsOptional()
  @IsIn(['recent', 'price_asc', 'price_desc', 'area_desc'])
  sort?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 24, maximum: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}
