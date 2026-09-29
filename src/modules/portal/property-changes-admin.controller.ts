import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { PortalChangeSettingsDto, ReviewPropertyChangeDto } from './dto/portal.dto';
import { PropertyChangesService } from './property-changes.service';

@Controller('property-changes')
@Roles(Role.ADMIN, Role.MANAGER)
export class PropertyChangesAdminController {
  constructor(private readonly changes: PropertyChangesService) {}

  @Get() list() { return this.changes.all(); }
  @Patch(':id/review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPropertyChangeDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.changes.review(id, dto.approved, actor.id, dto.resolution, actor);
  }
  @Get('settings/propagation') settings() { return this.changes.getSettings(); }

  /*
    El plazo de propagacion lo mueve SOLO la administracion.

    Es el unico ajuste de este controlador que no pertenece a una sede: vale
    para toda la empresa. Heredaba el `@Roles` de la clase, asi que un
    coordinador podia ponerlo en cero y, a partir de ahi, cualquier cambio
    aprobado desde el portal —en cualquier oficina, no solo la suya— se
    aplicaba al inventario en el acto, sin ventana para revertirlo.

    No es una fuga de datos: es quitarle el colchon a las demas sedes desde
    fuera. Leer el numero no hace daño, asi que el `GET` se queda como estaba.
  */
  @Patch('settings/propagation')
  @Roles(Role.ADMIN)
  updateSettings(@Body() dto: PortalChangeSettingsDto) {
    return this.changes.updateSettings(dto.propagationMinutes);
  }
}
