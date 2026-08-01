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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FamiliesService } from './families.service';
import {
  AssignFamilyDto,
  CreateFamilyDto,
  SearchFamiliesDto,
  UpdateFamilyDto,
} from './dto/family.dto';
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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.findById(id);
  }

  @Get('families/:id/properties')
  @ApiOperation({
    summary: 'Inmuebles del proyecto, incluidos los de sus etapas',
  })
  properties(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.propertiesOf(id);
  }

  @Get('families/:id/unit-types')
  @ApiOperation({
    summary: 'Tipologías del proyecto',
    description:
      'Agrupa las unidades por forma y tipo con su rango de área y precio: ' +
      '"Tipo A, 3 alcobas, 78–84 m², desde $320 M".',
  })
  unitTypes(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.unitTypes(id);
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
  })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignFamilyDto) {
    return this.families.assignProperty(id, dto.familyId ?? null, dto.unitType);
  }

  @Get('properties/:id/siblings')
  @ApiOperation({ summary: 'Otras unidades del mismo proyecto' })
  siblings(@Param('id', ParseUUIDPipe) id: string) {
    return this.families.siblingsOf(id);
  }
}
