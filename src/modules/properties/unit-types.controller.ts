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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnitTypesService } from './unit-types.service';
import {
  CreateUnitTypeDto,
  ReorderUnitTypesDto,
  UpdateUnitTypeDto,
} from './dto/unit-type.dto';
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
}
