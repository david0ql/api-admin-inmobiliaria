import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { CreateAgentDto, SetPasswordDto, UpdateAgentDto } from './agents.dto';
import { SetShiftsDto } from './shifts.dto';
import { Roles } from '../decorators';
import { Role } from '../domain/role.enum';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los asesores del equipo' })
  findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.agents.findAll(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.findVisible(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Da de alta un usuario',
    description:
      'El administrador da de alta a cualquiera; un coordinador solo asesores y perfiles de consulta, y siempre en su propia sede. Lo impone el servicio, no el formulario.',
  })
  create(@Body() dto: CreateAgentDto) {
    return this.agents.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(id, dto);
  }

  @Put(':id/password')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Restablece la contrasena de un asesor' })
  async setPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
  ) {
    await this.agents.setPassword(id, dto.password);
    return { ok: true };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Desactiva un asesor sin borrar su cartera' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.deactivate(id);
  }

  @Get(':id/shifts')
  @ApiOperation({ summary: 'Cuadro de turnos y guardias del asesor' })
  shifts(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.listShifts(id);
  }

  @Put(':id/shifts')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reemplaza el cuadro de turnos completo' })
  replaceShifts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetShiftsDto,
  ) {
    return this.agents.replaceShifts(id, dto);
  }
}
