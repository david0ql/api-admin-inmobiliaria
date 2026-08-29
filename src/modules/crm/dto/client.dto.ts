import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../shared/http/dto/page-query.dto';
import { csvNumbers, csvStrings } from '../../../shared/http/query-params';
import {
  InterestRole,
  InterestStatus,
} from '../domain/property-interest.entity';

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  @Length(1, 160)
  firstName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+573158100398' })
  @IsOptional()
  @IsString()
  @Length(5, 40)
  cellPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(5, 40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 40)
  identification?: string;

  @ApiPropertyOptional({ example: '1985-04-12' })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Ids del catalogo de tipos de cliente',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Type(() => Number)
  @IsInt({ each: true })
  typeIds?: number[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, el embudo marcado como default',
  })
  @IsOptional()
  @IsUUID()
  pipelineId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, la primera etapa del embudo',
  })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Por defecto, quien lo crea',
  })
  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sede. Solo la puede elegir quien ve todas; al resto se le impone la suya',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Que busca el cliente' })
  @IsOptional()
  @IsString()
  requirement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsMarketing?: boolean;
}

export class UpdateClientDto extends PartialType(CreateClientDto) {}

export class MoveStageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;

  @ApiPropertyOptional({
    description: 'Queda registrado en la bitacora del cliente',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class ReassignClientDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;
}

export class LinkPropertyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId: string;

  @ApiPropertyOptional({ enum: InterestRole, default: InterestRole.PROSPECT })
  @IsOptional()
  @IsEnum(InterestRole)
  role?: InterestRole;

  @ApiPropertyOptional({ enum: InterestStatus })
  @IsOptional()
  @IsEnum(InterestStatus)
  status?: InterestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  offeredAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SearchClientsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Nombre, correo, telefono o cedula' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  pipelineId?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @Transform(csvStrings)
  @IsArray()
  @IsUUID('4', { each: true })
  stageId?: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(csvNumbers)
  @IsArray()
  @IsInt({ each: true })
  typeId?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;

  @ApiPropertyOptional({
    description:
      'Solo clientes sin contacto desde esta fecha (clientes olvidados)',
    example: '2026-06-01',
  })
  @IsOptional()
  @IsDateString()
  staleSince?: string;

  @ApiPropertyOptional({
    description: 'true = solo etapas abiertas (ni ganadas ni perdidas)',
  })
  @IsOptional()
  @IsString()
  openOnly?: string;
}
