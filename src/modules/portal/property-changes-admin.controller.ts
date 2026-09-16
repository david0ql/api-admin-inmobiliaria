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
    return this.changes.review(id, dto.approved, actor.id, dto.resolution);
  }
  @Get('settings/propagation') settings() { return this.changes.getSettings(); }
  @Patch('settings/propagation') updateSettings(@Body() dto: PortalChangeSettingsDto) {
    return this.changes.updateSettings(dto.propagationMinutes);
  }
}
