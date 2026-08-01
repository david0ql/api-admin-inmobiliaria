import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { PipelinesService } from './pipelines.service';
import { ActivitiesService } from '../activity/activities.service';
import {
  CreateClientDto,
  LinkPropertyDto,
  MoveStageDto,
  ReassignClientDto,
  SearchClientsDto,
  UpdateClientDto,
} from './dto/client.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import { ActivityType } from '../activity/domain/activity.entity';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

export class MergeClientsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  duplicateIds: string[];
}

@ApiTags('crm')
@Controller()
export class CrmController {
  constructor(
    private readonly clients: ClientsService,
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
  ) {}

  // --- embudos -----------------------------------------------------------

  @Get('pipelines')
  @ApiOperation({ summary: 'Embudos con sus etapas' })
  listPipelines() {
    return this.pipelines.findAll();
  }

  @Get('pipelines/kanban')
  @ApiQuery({ name: 'pipelineId', required: false })
  @ApiOperation({ summary: 'Tablero con el numero de clientes por etapa' })
  kanban(
    @CurrentUser() actor: AuthenticatedActor,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.pipelines.kanban(pipelineId, actor);
  }

  // --- clientes ----------------------------------------------------------

  @Get('clients')
  @ApiOperation({ summary: 'Listado de clientes con filtros' })
  search(
    @Query() dto: SearchClientsDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.search(dto, actor);
  }

  @Get('clients/sources')
  @ApiOperation({ summary: 'Fuentes de captacion' })
  sources() {
    return this.clients.listSources();
  }

  @Get('clients/duplicates')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'Grupos de clientes que comparten telefono o correo',
  })
  duplicates(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.clients.findDuplicates(limit ?? 50);
  }

  @Get('clients/:id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.findOne(id, actor);
  }

  @Get('clients/:id/interests')
  @ApiOperation({ summary: 'Inmuebles vinculados al cliente' })
  interests(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.listInterests(id);
  }

  @Post('clients')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  create(
    @Body() dto: CreateClientDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.create(dto, actor);
  }

  @Patch('clients/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.update(id, dto, actor);
  }

  @Post('clients/:id/stage')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Mueve al cliente de etapa y lo anota en la bitacora',
  })
  async moveStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveStageDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    const { client, from, to } = await this.clients.moveStage(id, dto, actor);
    await this.activities.record({
      type: ActivityType.STAGE_CHANGE,
      clientId: id,
      agentId: actor.id,
      summary: `Etapa: ${from} → ${to}`,
      detail: dto.note ?? null,
    });
    return client;
  }

  @Post('clients/:id/reassign')
  @Roles(Role.ADMIN, Role.MANAGER)
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignClientDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.reassign(id, dto, actor);
  }

  @Post('clients/:id/interests')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Vincula un inmueble al cliente' })
  linkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkPropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.linkProperty(id, dto, actor);
  }

  @Delete('clients/:id/interests/:interestId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  unlinkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.unlinkProperty(id, interestId, actor);
  }

  @Post('clients/:id/merge')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Fusiona duplicados sobre este cliente' })
  merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeClientsDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.merge(id, dto.duplicateIds, actor);
  }

  @Delete('clients/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.clients.remove(id, actor);
  }

  // --- desde el inmueble -------------------------------------------------

  @Get('properties/:id/interests')
  @ApiOperation({ summary: 'Clientes interesados en el inmueble' })
  propertyInterests(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.listInterestedClients(id);
  }
}
