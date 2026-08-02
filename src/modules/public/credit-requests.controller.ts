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
import { CreditRequestsService } from './credit-requests.service';
import {
  ReviewCreditRequestDto,
  SearchCreditRequestsDto,
} from './dto/credit.dto';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/** Bandeja interna de las consultas de credito que llegan de la web publica. */
@ApiTags('credit-requests')
@Controller('credit-requests')
export class CreditRequestsController {
  constructor(private readonly credits: CreditRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Consultas de crédito, las nuevas primero' })
  search(@Query() dto: SearchCreditRequestsDto) {
    return this.credits.search(dto);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Cuántas hay en cada estado, para el contador' })
  counts() {
    return this.credits.counts();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.credits.findById(id);
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Cambia el estado de la consulta' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCreditRequestDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.credits.review(id, dto, actor);
  }

  @Post(':id/convert')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Pasa la consulta al embudo',
    description:
      'Crea el cliente con el caso escrito en el requerimiento, lo asigna a ' +
      'quien la toma y lo vincula al inmueble si la consulta traía uno.',
  })
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.credits.convert(id, actor);
  }
}
