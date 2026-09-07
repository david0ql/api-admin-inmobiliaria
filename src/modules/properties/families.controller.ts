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
import { FamiliesService } from './families.service';
import {
  AssignFamilyDto,
  CreateFamilyDto,
  SearchFamiliesDto,
  UpdateFamilyDto,
} from './dto/family.dto';
import { ReorderImagesDto } from './dto/property.dto';
import {
  DevelopImageDto,
  UpdateImageDto,
  UploadImagesDto,
} from './dto/image.dto';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';

@ApiTags('families')
@Controller()
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @Get('families')
  @ApiOperation({ summary: 'Proyectos y conjuntos' })
  search(@Query() dto: SearchFamiliesDto) {
    return this.families.search(dto);
  }

  @Get('families/tree')
  @ApiOperation({
    summary: 'Jerarquía completa, para el selector del formulario',
  })
  tree() {
    return this.families.trees();
  }

  @Get('families/unassigned')
  @ApiOperation({
    summary: 'Inmuebles que aún no pertenecen a ningún proyecto',
  })
  unassigned() {
    return this.families.unassigned();
  }

  @Get('families/:id')
  @ApiOperation({
    summary: 'Ficha del proyecto, con sus etapas y su galería',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.findById(id, { conImagenes: true });
  }

  @Get('families/:id/properties')
  @ApiOperation({
    summary: 'Inmuebles del proyecto, incluidos los de sus etapas',
  })
  properties(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.propertiesOf(id);
  }

  @Post('families')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Crea un proyecto; los inmuebles se asignan después',
  })
  create(@Body() dto: CreateFamilyDto) {
    return this.families.create(dto);
  }

  @Patch('families/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFamilyDto) {
    return this.families.update(id, dto);
  }

  @Patch('families/:id/images/:imageId/develop')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Revela la foto o le quita el revelado',
    description:
      'El revelado —niveles, balance de blancos, gamma y enfoque de salida— se ' +
      'aplica solo al subir. Esto lo rehace con el criterio de hoy o lo ' +
      'deshace: `aplicar: false` deja las cuatro variantes tal y como salieron ' +
      'de la camara, partiendo del original, que se conserva siempre.',
  })
  developImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: DevelopImageDto,
  ) {
    return this.families.developImage(id, imageId, dto.aplicar);
  }

  @Delete('families/:id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.remove(id);
  }

  // --- desde el inmueble -------------------------------------------------

  @Patch('properties/:id/family')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Asigna el inmueble a un proyecto (o lo desvincula)',
    description:
      'La tipología se pone después con PATCH /properties/:id: al cambiar de ' +
      'proyecto se limpia, porque pertenece al proyecto que se deja atrás.',
  })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignFamilyDto) {
    return this.families.assignProperty(id, dto.familyId ?? null);
  }

  @Get('properties/:id/siblings')
  @ApiOperation({ summary: 'Otras unidades del mismo proyecto' })
  siblings(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.siblingsOf(id);
  }

  // --- imagenes ----------------------------------------------------------

  @Get('families/:id/images')
  @ApiOperation({ summary: 'Galería del proyecto' })
  images(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.imagesOf(id);
  }

  @Post('families/:id/images')
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
    summary: 'Sube imágenes del proyecto',
    description:
      'Multipart en el campo `files`. `kind` marca el lote entero: PHOTO ' +
      '(por defecto) o FLOOR_PLAN, que es la implantación del conjunto.',
  })
  addImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadImagesDto,
  ) {
    return this.families.addImages(id, files, dto.kind);
  }

  @Put('families/:id/images/order')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reordena la galería' })
  reorderImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.families.reorderImages(id, dto.imageIds);
  }

  @Patch('families/:id/images/:imageId/main')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Elige la portada' })
  setMainImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.families.setMainImage(id, imageId);
  }

  @Patch('families/:id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Cambia el pie de la imagen o la marca como plano' })
  updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ) {
    return this.families.updateImage(id, imageId, dto);
  }

  @Delete('families/:id/images/:imageId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra la imagen y sus ficheros del servidor' })
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.families.removeImage(id, imageId);
  }
}
