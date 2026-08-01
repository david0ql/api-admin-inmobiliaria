import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PageQueryDto } from '../../shared/http/dto/page-query.dto';
import {
  AppointmentStatus,
  AppointmentType,
} from './domain/appointment.entity';
import { ActivityType } from '../activity/domain/activity.entity';

export class CreateAppointmentDto {
  @ApiProperty({ example: 'Visita apartamento Cañaveral' })
  @IsString()
  @Length(3, 200)
  title: string;

  @ApiPropertyOptional({
    enum: AppointmentType,
    default: AppointmentType.VISIT,
  })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiProperty({ example: '2026-08-05T15:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-08-05T16:00:00.000Z' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, quien la crea',
  })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 300)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Permite agendar fuera del turno del asesor o solapando otra cita',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ description: 'Resultado de la cita' })
  @IsOptional()
  @IsString()
  outcome?: string;
}

export class SearchAppointmentsDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ enum: AppointmentType })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;
}

export class CalendarQueryDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, toda la agencia',
  })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class CreateActivityDto {
  @ApiProperty({ enum: ActivityType })
  @IsEnum(ActivityType)
  type: ActivityType;

  @ApiProperty()
  @IsString()
  @Length(1, 300)
  summary: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Por defecto, ahora' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CloseAppointmentDto {
  @ApiProperty({
    enum: [
      AppointmentStatus.DONE,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.CANCELED,
    ],
  })
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outcome?: string;
}

export class TimelineQueryDto {
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
