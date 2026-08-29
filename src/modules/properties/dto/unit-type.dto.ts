import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { UnitTypeKind } from '../domain/unit-type.entity';

export class CreateUnitTypeDto {
  @ApiProperty({
    example: 'A',
    description: 'Corto y unico dentro del proyecto',
  })
  @IsString()
  @Length(1, 8)
  code: string;

  @ApiProperty({ example: 'Tipo A · 2 alcobas · 58 m²' })
  @IsString()
  @Length(2, 160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: UnitTypeKind,
    default: UnitTypeKind.FIXED,
    description:
      'AUTO solo para suelo, donde la tipologia es el tramo de area y no una ' +
      'decision de la agencia',
  })
  @IsOptional()
  @IsEnum(UnitTypeKind)
  kind?: UnitTypeKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  bathrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  garages?: number;

  @ApiPropertyOptional({ description: 'Area minima del rango, en m²' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  areaMin?: number;

  @ApiPropertyOptional({ description: 'Area maxima del rango, en m²' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  areaMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  builtArea?: number;

  @ApiPropertyOptional({ description: 'Orden en que se enseña; 0 primero' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32000)
  position?: number;
}

export class UpdateUnitTypeDto extends PartialType(CreateUnitTypeDto) {}

export class ReorderUnitTypesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Ids en el orden deseado; todas las del proyecto',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  unitTypeIds: string[];
}
