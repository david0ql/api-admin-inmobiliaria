import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { HomeSettingsService } from './home-settings.service';
import { HomeSettings } from './domain/home-settings.entity';
import { UpdateHomeSettingsDto } from './dto/home-settings.dto';

/**
 * El escaparate de la portada, desde el panel.
 *
 * Leerlo lo puede el equipo; cambiarlo no: es lo primero que ve cualquiera que
 * entre en la web.
 */
@ApiTags('public')
@Controller('settings/home')
export class HomeSettingsController {
  constructor(private readonly settings: HomeSettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Configuración del carrusel de la portada' })
  get(): Promise<HomeSettings> {
    return this.settings.get();
  }

  @Put()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Cambia el carrusel de la portada' })
  update(@Body() dto: UpdateHomeSettingsDto): Promise<HomeSettings> {
    return this.settings.update(dto);
  }
}
