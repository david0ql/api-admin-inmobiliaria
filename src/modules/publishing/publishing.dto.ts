import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { PublicationState } from './domain/property-publication.entity';

export class SetPublicationsDto {
  @ApiProperty({
    type: [Number],
    description: 'Portales donde debe estar el inmueble',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  portalIds: number[];
}

export class UpdatePublicationDto {
  @ApiPropertyOptional({ enum: PublicationState })
  @IsOptional()
  @IsEnum(PublicationState)
  state?: PublicationState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  externalUrl?: string;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional({
    description:
      'Credenciales por campo. Un campo vacio conserva lo guardado; los secretos nunca se devuelven.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Ajustes no secretos. Un campo vacio lo borra.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;

  @ApiPropertyOptional({ description: 'Publicar solos los inmuebles nuevos' })
  @IsOptional()
  @IsBoolean()
  autoPublishNew?: boolean;
}

export class SetLocationDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  cityId: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Vacio: equivalencia de la ciudad entera',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  zoneId?: number | null;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  externalId: string;

  @ApiProperty()
  @IsString()
  @Length(1, 300)
  externalName: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  extra?: Record<string, string>;
}
