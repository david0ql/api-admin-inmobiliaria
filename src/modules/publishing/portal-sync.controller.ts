import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Delete,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { assertCanMutate } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { PropertiesService } from '../properties/properties.service';
import { SyncAction } from './domain/property-publication.entity';
import { SetLocationDto, UpdateConnectionDto } from './publishing.dto';
import { LocationsService } from './sync/locations.service';
import { ConnectionsService } from './sync/connections.service';
import { PortalSyncService } from './sync/portal-sync.service';

@ApiTags('publishing')
@Controller()
export class PortalSyncController {
  constructor(
    private readonly sync: PortalSyncService,
    private readonly connections: ConnectionsService,
    private readonly properties: PropertiesService,
    private readonly locations: LocationsService,
  ) {}

  // --- la ficha del inmueble --------------------------------------------

  @Get('properties/:id/portal-sync')
  @ApiOperation({ summary: 'Estado del inmueble en cada portal conectado' })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    // `findOne` aplica sede y cartera: nadie mira portales de lo que no ve.
    await this.properties.findOne(id, actor);
    return this.sync.describe(id);
  }

  @Post('properties/:id/portal-sync')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Envia o actualiza el inmueble en todos los portales conectados',
  })
  async syncAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    await this.assertWritable(id, actor);
    await this.sync.syncAll(id);
    return this.sync.describe(id);
  }

  @Post('properties/:id/portal-sync/:portalId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Envia o actualiza el inmueble en un portal' })
  async syncOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('portalId', ParseIntPipe) portalId: number,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    await this.assertWritable(id, actor);
    await this.sync.syncNow(id, portalId, SyncAction.UPSERT);
    return this.sync.describe(id);
  }

  @Post('properties/:id/portal-sync/:portalId/remove')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Retira el inmueble de un portal' })
  async removeOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('portalId', ParseIntPipe) portalId: number,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    await this.assertWritable(id, actor);
    await this.sync.syncNow(id, portalId, SyncAction.REMOVE);
    return this.sync.describe(id);
  }

  // --- conexiones (solo administracion) -----------------------------------

  @Get('publishing/connections')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Portales con integracion y su configuracion (sin secretos)',
  })
  listConnections() {
    return this.connections.list();
  }

  @Patch('publishing/connections/:portalId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Guarda credenciales y ajustes de un portal' })
  updateConnection(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.connections.update(portalId, dto);
  }

  @Post('publishing/connections/:portalId/test')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Prueba las credenciales contra el portal' })
  testConnection(@Param('portalId', ParseIntPipe) portalId: number) {
    return this.connections.test(portalId);
  }

  // --- equivalencias de ubicacion (solo administracion) -------------------

  @Get('publishing/connections/:portalId/locations')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Ciudades y zonas con inmuebles y su equivalencia en el portal',
  })
  locationsOverview(@Param('portalId', ParseIntPipe) portalId: number) {
    return this.locations.overview(portalId);
  }

  @Get('publishing/connections/:portalId/locations/search')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Busca en el catalogo geografico del portal' })
  searchLocations(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Query('q') q: string,
    @Query('cityId') cityId?: string,
  ) {
    return this.locations.search(
      portalId,
      q ?? '',
      cityId ? Number(cityId) : undefined,
    );
  }

  @Put('publishing/connections/:portalId/locations')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Fija la equivalencia de una ciudad o zona' })
  setLocation(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Body() dto: SetLocationDto,
  ) {
    return this.locations.set(portalId, dto);
  }

  @Delete('publishing/connections/:portalId/locations/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Quita una equivalencia' })
  removeLocation(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.remove(portalId, id);
  }

  @Post('publishing/connections/:portalId/locations/auto')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Propone equivalencias por nombre exacto (por tandas)',
  })
  autoMatchLocations(@Param('portalId', ParseIntPipe) portalId: number) {
    return this.locations.autoMatch(portalId);
  }

  private async assertWritable(
    id: string,
    actor: AuthenticatedActor,
  ): Promise<void> {
    const property = await this.properties.findOne(id, actor);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');
  }
}
