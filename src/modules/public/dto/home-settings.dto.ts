import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ShowcaseEffect, ShowcaseSource } from '../domain/home-settings.entity';

export class UpdateHomeSettingsDto {
  @ApiPropertyOptional({ description: 'Si el carrusel se enseña.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ShowcaseSource })
  @IsOptional()
  @IsEnum(ShowcaseSource)
  source?: ShowcaseSource;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  codes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(24)
  count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoplay?: boolean;

  /** Entre dos y quince segundos: menos no da tiempo a leer, mas no se nota. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(15000)
  delayMs?: number;

  @ApiPropertyOptional({ enum: ShowcaseEffect })
  @IsOptional()
  @IsEnum(ShowcaseEffect)
  effect?: ShowcaseEffect;
}
