import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { LeadMode } from '../domain/booking-settings.entity';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** `HH:MM`, 24 horas. */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkdayDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @Matches(HORA, { message: 'La hora de apertura va como HH:MM' })
  from: string;

  @Matches(HORA, { message: 'La hora de cierre va como HH:MM' })
  to: string;

  @IsBoolean()
  open: boolean;
}

export class UpdateBookingSettingsDto {
  @ApiPropertyOptional({ enum: LeadMode })
  @IsOptional()
  @IsEnum(LeadMode)
  leadMode?: LeadMode;

  @ApiPropertyOptional({ description: 'Antelación única, en horas.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  uniformLeadHours?: number;

  @ApiPropertyOptional({ type: [WorkdayDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkdayDto)
  workdays?: WorkdayDto[];

  /**
   * Se validan como objeto y no campo a campo porque las claves son los
   * estados de disponibilidad, y añadir uno nuevo no debería obligar a tocar
   * este DTO. Los valores fuera de rango los recorta el servicio.
   */
  @ApiPropertyOptional({ example: { AVAILABLE: 1, RESERVED: 2, WITHDRAWN: 5 } })
  @IsOptional()
  @IsObject()
  leadDaysByAvailability?: Record<string, number>;

  @ApiPropertyOptional({ example: { sale: 1, rent: 2 } })
  @IsOptional()
  @IsObject()
  leadDaysByOperation?: { sale: number; rent: number };

  @ApiPropertyOptional({
    description: 'Cuántas horas próximas propone el chat.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  suggestedSlots?: number;

  @ApiPropertyOptional({ description: 'Duración de cada visita, en minutos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  slotMinutes?: number;
}
