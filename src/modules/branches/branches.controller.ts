import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { BranchesService } from './branches.service';

class CreateBranchDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsString()
  @Length(2, 12)
  code: string;

  @IsOptional()
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class UpdateBranchDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(2, 12) code?: string;
  @IsOptional() @IsInt() cityId?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class SetCoordinatorDto {
  @IsUUID()
  agentId: string;
}

/**
 * Las sedes.
 *
 * Leerlas puede cualquiera con sesion —el panel necesita saber en cual esta y
 * pintar el selector—, pero crearlas y tocarlas es solo del administrador:
 * abrir una oficina es una decision de la empresa, no de una oficina.
 */
@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'Las sedes que puedo ver' })
  list() {
    return this.branches.list();
  }

  @Get('coordinators')
  @Roles(Role.ADMIN, Role.DIRECTOR)
  @ApiOperation({ summary: 'Quien coordina cada sede' })
  coordinators() {
    return this.branches.coordinators();
  }

  @Get(':id/team')
  @ApiOperation({ summary: 'El equipo de una sede' })
  team(@Param('id') id: string) {
    return this.branches.team(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Abrir una sede' })
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cambiar los datos de una sede' })
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Post(':id/coordinator')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Poner coordinador a una sede',
    description:
      'El usuario pasa a rol COORDINATOR y queda asignado a esa sede. Es el paso que sigue a crearla.',
  })
  setCoordinator(@Param('id') id: string, @Body() dto: SetCoordinatorDto) {
    return this.branches.setCoordinator(id, dto.agentId);
  }
}
