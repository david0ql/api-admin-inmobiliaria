import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { BookingSettingsService } from './booking-settings.service';
import { BookingSettings } from './domain/booking-settings.entity';
import { UpdateBookingSettingsDto } from './dto/booking-settings.dto';

/**
 * Los parámetros de la agenda, desde el panel.
 *
 * Leerlos lo puede hacer cualquiera del equipo —el asesor necesita saber a qué
 * hora se atiende—, pero cambiarlos no: mover el horario o la antelación
 * mínima afecta a lo que la web ofrece a todo el mundo.
 */
@ApiTags('scheduling')
@Controller('settings/booking')
export class BookingSettingsController {
  constructor(private readonly settings: BookingSettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Horario de atención y antelación mínima' })
  get(): Promise<BookingSettings> {
    return this.settings.get();
  }

  @Put()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Cambia los parámetros de la agenda' })
  update(@Body() dto: UpdateBookingSettingsDto): Promise<BookingSettings> {
    return this.settings.update(dto);
  }
}
