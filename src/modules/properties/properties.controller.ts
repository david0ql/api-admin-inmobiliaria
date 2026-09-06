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
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import {
  AssignPropertyDto,
  CreatePropertyDto,
  ReorderImagesDto,
  UpdatePropertyDto,
} from './dto/property.dto';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { UpdateImageDto, UploadImagesDto } from './dto/image.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listado de inmuebles con filtros',
    description:
      'Un AGENT ve solo los inmuebles a su nombre; ADMIN, MANAGER y VIEWER ven todo el inventario.',
  })
  search(
    @Query() dto: SearchPropertiesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.search(dto, actor);
  }

  @Get('labels')
  @ApiOperation({ summary: 'Etiquetas de color disponibles' })
  labels() {
    return this.properties.listLabels();
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.findOne(id, actor);
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: 'Historico de asesores del inmueble' })
  assignments(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.assignmentHistory(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  create(
    @Body() dto: CreatePropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.create(dto, actor);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.update(id, dto, actor);
  }

  @Patch(':id/assign')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reasigna el inmueble dejando historico' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.assign(id, dto, actor);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  @ApiOperation({ summary: 'Retira el inmueble (borrado logico)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.remove(id, actor);
  }

  @Post(':id/visits')
  @HttpCode(204)
  @ApiOperation({ summary: 'Registra una visita a la ficha' })
  visit(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.registerVisit(id);
  }

  // --- imagenes ----------------------------------------------------------

  @Post(':id/images')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @UseInterceptors(FilesInterceptor('files', 30))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        kind: { type: 'string', enum: ['PHOTO', 'FLOOR_PLAN'] },
      },
    },
  })
  @ApiOperation({
    summary: 'Sube fotos o planos del inmueble',
    description:
      'Multipart en el campo `files`. Cada imagen se recomprime a WebP en ' +
      'cuatro anchos y se guarda en el servidor; no se enlaza a ningun CDN ' +
      'externo. `kind` marca el lote entero: PHOTO (por defecto) o FLOOR_PLAN.',
  })
  addImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadImagesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.addImages(id, files, actor, dto.kind);
  }

  @Put(':id/images/order')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderImagesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.reorderImages(id, dto, actor);
  }

  @Patch(':id/images/:imageId/main')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  setMain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.setMainImage(id, imageId, actor);
  }

  @Patch(':id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Cambia el pie de la imagen o la marca como plano',
  })
  updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.updateImage(id, imageId, dto, actor);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.properties.removeImage(id, imageId, actor);
  }
}
