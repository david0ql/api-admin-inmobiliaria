import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AnalyzePropertyDto {
  /**
   * Que fotos analizar. Sin esto van las que falten por analizar, hasta el tope
   * del lote. Poder elegir es poder gastar solo en las tres que se acaban de
   * subir en vez de en las veinte que ya estaban.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  imageIds?: string[];

  /**
   * Repetir lo ya analizado con este mismo prompt y este mismo modelo.
   *
   * Por defecto no se repite, porque repetir la misma pregunta es pagarla dos
   * veces. Se activa a mano justo despues de tocar el prompt, que es cuando la
   * pregunta ya no es la misma.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SavePromptDto {
  @ApiProperty({ description: 'El prompt de sistema completo' })
  @IsString()
  @MaxLength(20_000)
  body: string;

  @ApiPropertyOptional({ description: 'Por que se cambia' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateGateRulesDto {
  /**
   * Los umbrales a cambiar. `null` en uno devuelve el valor del repositorio,
   * que es la unica forma de deshacer sin acordarse de cual era el bueno.
   */
  @ApiProperty({
    description: 'Umbrales a cambiar; null en uno vuelve al valor de fabrica',
    example: { minWidth: 1200, minSharpness: null },
  })
  @IsObject()
  rules: Record<string, number | boolean | null>;
}

export class CreateSamplesDto {
  @ApiPropertyOptional({ default: 3, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  count?: number;
}
