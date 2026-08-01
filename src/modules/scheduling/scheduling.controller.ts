import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchedulingService } from './scheduling.service';
import { ActivitiesService } from '../activity/activities.service';
import {
  CalendarQueryDto,
  CloseAppointmentDto,
  CreateActivityDto,
  CreateAppointmentDto,
  SearchAppointmentsDto,
  TimelineQueryDto,
  UpdateAppointmentDto,
} from './scheduling.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

@ApiTags('scheduling')
@Controller()
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly activities: ActivitiesService,
  ) {}

  // --- citas -------------------------------------------------------------

  @Get('appointments')
  @ApiOperation({ summary: 'Listado de citas con filtros' })
  search(
    @Query() dto: SearchAppointmentsDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.search(dto, actor);
  }

  @Get('appointments/:id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.findOne(id, actor);
  }

  @Post('appointments')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Agenda una cita',
    description:
      'Rechaza solapes con otra cita del asesor y horas fuera de su turno; `force: true` los ignora.',
  })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.create(dto, actor);
  }

  @Patch('appointments/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.update(id, dto, actor);
  }

  @Post('appointments/:id/close')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Cierra la cita y lo anota en la bitacora del cliente',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseAppointmentDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.close(id, dto, actor);
  }

  @Delete('appointments/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.remove(id, actor);
  }

  // --- calendario --------------------------------------------------------

  @Get('calendar')
  @ApiOperation({
    summary: 'Citas agrupadas por dia, con los turnos del asesor',
  })
  calendar(
    @Query() dto: CalendarQueryDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.scheduling.calendar(dto, actor);
  }

  @Get('calendar/today')
  @ApiOperation({ summary: 'Agenda de hoy del asesor autenticado' })
  today(@CurrentUser() actor: AuthenticatedActor) {
    return this.scheduling.agenda(
      actor.id,
      new Date().toISOString().slice(0, 10),
    );
  }

  // --- bitacora ----------------------------------------------------------

  @Get('clients/:id/timeline')
  @ApiOperation({
    summary: 'Historial del cliente: actividades y citas en un solo hilo',
  })
  timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TimelineQueryDto,
  ) {
    return this.scheduling.timelineForClient(id, query.limit ?? 100);
  }

  @Get('properties/:id/activities')
  @ApiOperation({ summary: 'Actividad registrada sobre el inmueble' })
  propertyActivities(@Param('id', ParseUUIDPipe) id: string) {
    return this.activities.listForProperty(id);
  }

  @Post('activities')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Registra una gestion: llamada, nota, correo…' })
  createActivity(
    @Body() dto: CreateActivityDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.activities.record({
      type: dto.type,
      summary: dto.summary,
      detail: dto.detail ?? null,
      clientId: dto.clientId ?? null,
      propertyId: dto.propertyId ?? null,
      agentId: actor.id,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
      automatic: false,
    });
  }

  @Delete('activities/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  removeActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.activities.remove(id);
  }
}
