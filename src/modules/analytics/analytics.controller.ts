import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Cifras de cabecera del panel' })
  overview(@CurrentUser() actor: AuthenticatedActor) {
    return this.analytics.overview(actor);
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Inventario por ciudad y por tipo' })
  async inventory(@CurrentUser() actor: AuthenticatedActor) {
    const [byCity, byType] = await Promise.all([
      this.analytics.inventoryByCity(actor),
      this.analytics.inventoryByType(actor),
    ]);
    return { byCity, byType };
  }

  @Get('funnel')
  @ApiQuery({ name: 'pipelineId', required: false })
  @ApiOperation({ summary: 'Embudo por etapa, con dias medios de permanencia' })
  funnel(
    @CurrentUser() actor: AuthenticatedActor,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.analytics.funnel(actor, pipelineId);
  }

  @Get('sources')
  @ApiOperation({ summary: 'Leads y conversion por canal de captacion' })
  sources(@CurrentUser() actor: AuthenticatedActor) {
    return this.analytics.sources(actor);
  }

  @Get('agents')
  @Roles(Role.ADMIN, Role.MANAGER, Role.VIEWER)
  @ApiOperation({ summary: 'Carga y resultados por asesor' })
  agents() {
    return this.analytics.agentWorkload();
  }

  @Get('attention')
  @ApiOperation({
    summary: 'Inmuebles publicados con visitas pero sin ningun interesado',
  })
  attention(@CurrentUser() actor: AuthenticatedActor) {
    return this.analytics.attentionNeeded(actor);
  }
}
