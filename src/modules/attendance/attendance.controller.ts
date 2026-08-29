import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import {
  AttendanceHistoryDto,
  AttendanceRangeDto,
  CreateAttendanceMarkDto,
} from './attendance.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * Fichaje.
 *
 * Las tres primeras rutas son de cualquiera que tenga token —incluido el
 * administrador, que no esta obligado a fichar pero tampoco tiene por que
 * romperse si lo hace— y siempre hablan de UNA sola persona: la del token. No
 * existe ninguna forma de marcar en nombre de otro, ni de leer el dia de otro
 * por estas rutas.
 *
 * La cuarta es la de la historia, y ahi el rol abre la puerta pero el alcance
 * lo sigue decidiendo la consulta: administracion y direccion ven todas las
 * sedes, un coordinador solo la suya.
 */
@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('marks')
  @ApiOperation({
    summary: 'Marca entrada o salida en el instante de la petición',
    description:
      'Las coordenadas son obligatorias: sin ellas responde 400. Repetir la ' +
      'misma marca dos veces seguidas responde 409. Quien marca sale del ' +
      'token, nunca del cuerpo. Devuelve la marca creada y el estado del día.',
  })
  mark(
    @Body() dto: CreateAttendanceMarkDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.attendance.mark(dto, actor);
  }

  @Get('today')
  @ApiOperation({
    summary: 'Mi estado de hoy: si estoy dentro, mi última marca y el total',
  })
  today(@CurrentUser() actor: AuthenticatedActor) {
    return this.attendance.today(actor);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Mi historial por rango de fechas, con el consolidado por día',
  })
  mine(
    @Query() dto: AttendanceRangeDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.attendance.mine(dto, actor);
  }

  @Get('history')
  @Roles(Role.ADMIN, Role.DIRECTOR, Role.COORDINATOR, Role.MANAGER)
  @ApiOperation({
    summary: 'Historia del equipo: quién, cuándo y desde dónde',
    description:
      'Filtros por rango de fechas y por persona. Devuelve las marcas con ' +
      'coordenadas y dirección para el mapa, y emparejadas en jornadas para ' +
      'poder unir cada entrada con su salida.',
  })
  history(
    @Query() dto: AttendanceHistoryDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.attendance.history(dto, actor);
  }
}
