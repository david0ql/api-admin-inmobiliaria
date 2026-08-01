import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsignmentsService } from './consignments.service';
import {
  ReviewConsignmentDto,
  SearchConsignmentsDto,
} from './dto/consignment.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/** Bandeja interna de las solicitudes que llegan de la web publica. */
@ApiTags('consignments')
@Controller('consignments')
export class ConsignmentsController {
  constructor(private readonly consignments: ConsignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Solicitudes de consignación, las nuevas primero' })
  search(@Query() dto: SearchConsignmentsDto) {
    return this.consignments.search(dto);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Cuántas hay en cada estado, para el contador del menú',
  })
  counts() {
    return this.consignments.counts();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.consignments.findById(id);
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Cambia el estado de la solicitud' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewConsignmentDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.consignments.review(id, dto, actor);
  }

  @Post(':id/accept')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Convierte la solicitud en inmueble',
    description:
      'Crea el inmueble en borrador con las fotos del propietario, da de alta ' +
      'al propietario como cliente y los vincula. Requiere que la ciudad y el ' +
      'tipo estén resueltos contra el catálogo.',
  })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.consignments.accept(id, actor);
  }
}
