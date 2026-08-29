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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { CreateAgentDto, SetPasswordDto, UpdateAgentDto } from './agents.dto';
import { SetShiftsDto } from './shifts.dto';
import { CurrentUser, Roles } from '../decorators';
import { Role } from '../domain/role.enum';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedActor } from '../../../shared/request-context/request-context';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly auth: AuthService,
  ) {}

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

  /*
    Sin `@Roles`: por aqui pasa tambien cada uno editando su propia ficha, y
    una lista de roles en la ruta no sabe distinguir "es el suyo" de "es el de
    otro". El permiso lo decide el servicio, que si tiene delante a quien pide
    y a quien se edita.
  */
  @Patch(':id')
  @ApiOperation({
    summary: 'Edita la ficha de una persona',
    description:
      'La administracion a cualquiera; la direccion a todos menos a la administracion; quien manda en una sede, a los asesores y perfiles de consulta de la suya; y cada uno la propia. El perfil y la sede solo los mueve la administracion, y nunca sobre si misma.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(id, dto);
  }

  /**
   * Restablecer la contrasena de OTRA persona.
   *
   * No pide la contrasena vieja porque quien restablece no la sabe. Por eso
   * mismo no vale para uno mismo: para la propia esta
   * `POST /auth/change-password`, que si la exige. El servicio rechaza el caso
   * en vez de dejarlo a la buena fe de la pantalla.
   */
  @Put(':id/password')
  @ApiOperation({ summary: 'Restablece la contrasena de otra persona' })
  async setPassword(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
  ) {
    await this.auth.resetPasswordFor(actor, id, dto.password);
    return { ok: true };
  }

  /*
    Sin `@Roles` por lo mismo que el PATCH: cada uno cambia su propia foto, y
    la ruta no distingue eso de cambiarle la foto a otro. Decide el servicio.
  */
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Cambia la foto de perfil' })
  setPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.agents.setPhoto(id, file);
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
