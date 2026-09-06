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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnitTypesService } from './unit-types.service';
import {
  CreateUnitTypeDto,
  ReorderUnitTypesDto,
  UpdateUnitTypeDto,
} from './dto/unit-type.dto';
import { ReorderImagesDto } from './dto/property.dto';
import { UpdateImageDto, UploadImagesDto } from './dto/image.dto';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';

/**
 * Tipologías de un proyecto.
 *
 * Cuelgan del proyecto y no del inmueble: el "Tipo A" es del edificio, y por
 * eso se crean y se ordenan desde su ficha. Lo que se decide en el inmueble es
 * a cuál de ellas pertenece, y eso va en `PATCH /properties/:id`.
 */
@ApiTags('unit-types')
@Controller()
export class UnitTypesController {
  constructor(private readonly unitTypes: UnitTypesService) {}

  @Get('families/:id/unit-types')
  @ApiOperation({
    summary: 'Tipologías del proyecto con sus unidades',
    description:
      'Cada tipología con lo que la agencia escribió y lo que sale de contar ' +
      'sus inmuebles: "Tipo A, 3 alcobas, 78–84 m², 12 unidades, 4 ' +
      'disponibles, desde $320 M".',
  })
  summaries(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitTypes.summaries(id);
  }

  @Get('families/:id/unit-types/raw')
  @ApiOperation({
    summary: 'Las tipologías sin agregados, para el formulario que las edita',
  })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitTypes.listOf(id);
  }

  @Post('families/:id/unit-types')
  @Roles(Role.ADMIN, Role.MANAGER)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUnitTypeDto,
  ) {
    return this.unitTypes.create(id, dto);
  }

  @Put('families/:id/unit-types/order')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Reordena las tipologías del proyecto' })
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderUnitTypesDto,
  ) {
    return this.unitTypes.reorder(id, dto);
  }

  @Patch('unit-types/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitTypeDto,
  ) {
    return this.unitTypes.update(id, dto);
  }

  @Delete('unit-types/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Borra la tipología',
    description:
      'Los inmuebles que la tuvieran se quedan sin tipología; no se borra ' +
      'ninguno.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitTypes.remove(id);
  }

  // --- imagenes ----------------------------------------------------------

  @Get('unit-types/:id/images')
  @ApiOperation({ summary: 'Planos y fotos de la tipología' })
  images(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitTypes.imagesOf(id);
  }

  @Post('unit-types/:id/images')
  @Roles(Role.ADMIN, Role.MANAGER)
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
    summary: 'Sube el plano de la tipología',
    description:
      'Multipart en el campo `files`. Aquí `kind` vale FLOOR_PLAN por defecto: ' +
      'lo que se sube a una tipología es el plano.',
  })
  addImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadImagesDto,
  ) {
    return this.unitTypes.addImages(id, files, dto.kind);
  }

  @Put('unit-types/:id/images/order')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reordena la galería' })
  reorderImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.unitTypes.reorderImages(id, dto.imageIds);
  }

  @Patch('unit-types/:id/images/:imageId/main')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Elige la portada' })
  setMainImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.unitTypes.setMainImage(id, imageId);
  }

  @Patch('unit-types/:id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Cambia el pie de la imagen o la marca como plano' })
  updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ) {
    return this.unitTypes.updateImage(id, imageId, dto);
  }

  @Delete('unit-types/:id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra la imagen y sus ficheros del servidor' })
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.unitTypes.removeImage(id, imageId);
  }
}
