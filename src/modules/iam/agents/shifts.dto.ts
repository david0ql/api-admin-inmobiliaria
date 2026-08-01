import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ShiftKind } from '../domain/agent-shift.entity';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class ShiftDto {
  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = domingo … 6 = sabado',
  })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: '08:00' })
  @Matches(TIME, { message: 'startTime debe tener formato HH:mm' })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Matches(TIME, { message: 'endTime debe tener formato HH:mm' })
  endTime: string;

  @ApiPropertyOptional({ enum: ShiftKind, default: ShiftKind.OFFICE })
  @IsOptional()
  @IsEnum(ShiftKind)
  kind?: ShiftKind;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class SetShiftsDto {
  @ApiProperty({ type: [ShiftDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts: ShiftDto[];
}
