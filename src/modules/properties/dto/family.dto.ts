import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { FamilyKind, FamilyStatus } from '../domain/property-family.entity';

export class CreateFamilyDto {
  @ApiProperty({ example: 'Reserva de la Loma' })
  @IsString()
  @Length(3, 200)
  name: string;

  @ApiPropertyOptional({ description: 'Se genera desde el nombre si se omite' })
  @IsOptional()
  @IsString()
  @Length(3, 220)
  slug?: string;

  @ApiPropertyOptional({ enum: FamilyKind, default: FamilyKind.COMPLEX })
  @IsOptional()
  @IsEnum(FamilyKind)
  kind?: FamilyKind;

  @ApiPropertyOptional({ enum: FamilyStatus, default: FamilyStatus.DELIVERED })
  @IsOptional()
  @IsEnum(FamilyStatus)
  status?: FamilyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Constructora o promotora' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  developer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  zoneId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 2027 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  deliveryYear?: number;

  @ApiPropertyOptional({ description: 'Total de unidades del proyecto' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30000)
  totalUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Proyecto del que esta es una etapa o torre',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sede. Solo la puede elegir quien ve todas; al resto se le impone la suya',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateFamilyDto extends PartialType(CreateFamilyDto) {}

export class AssignFamilyDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Null para desvincular' })
  @IsOptional()
  @IsUUID()
  familyId?: string | null;
}

export class SearchFamiliesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional({ enum: FamilyKind })
  @IsOptional()
  @IsEnum(FamilyKind)
  kind?: FamilyKind;

  @ApiPropertyOptional({ enum: FamilyStatus })
  @IsOptional()
  @IsEnum(FamilyStatus)
  status?: FamilyStatus;

  @ApiPropertyOptional({ description: 'true = solo los visibles en la web' })
  @IsOptional()
  @IsString()
  publishedOnly?: string;

  @ApiPropertyOptional({
    description: 'true = solo proyectos raíz, sin etapas',
  })
  @IsOptional()
  @IsString()
  rootsOnly?: string;
}
