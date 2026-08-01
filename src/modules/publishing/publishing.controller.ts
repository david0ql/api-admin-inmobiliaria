import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublishingService } from './publishing.service';
import { SetPublicationsDto, UpdatePublicationDto } from './publishing.dto';
import { Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';

@ApiTags('publishing')
@Controller()
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Get('properties/:id/publications')
  @ApiOperation({ summary: 'Portales donde esta publicado el inmueble' })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.listForProperty(id);
  }

  @Put('properties/:id/publications')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Fija el conjunto de portales del inmueble' })
  set(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPublicationsDto) {
    return this.publishing.setPublications(id, dto);
  }

  @Patch('properties/:id/publications/:portalId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Actualiza el estado de una publicacion concreta' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('portalId', ParseIntPipe) portalId: number,
    @Body() dto: UpdatePublicationDto,
  ) {
    return this.publishing.updateOne(id, portalId, dto);
  }

  @Get('publishing/coverage')
  @ApiOperation({ summary: 'Cuantos inmuebles hay en cada portal' })
  coverage() {
    return this.publishing.coverage();
  }

  @Get('publishing/gaps')
  @ApiOperation({ summary: 'Inmuebles activos que no estan en ningun portal' })
  gaps() {
    return this.publishing.unpublishedActiveProperties();
  }
}
