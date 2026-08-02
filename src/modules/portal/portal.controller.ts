import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../iam/decorators';
import {
  DOCUMENT_FIELDS,
  storeConsignmentFiles,
} from '../public/consignment-files';

import { PublicService } from '../public/public.service';
import { StorageService } from '../media/storage.service';
import { ClientAuthGuard, CurrentClient } from './client-auth.guard';
import type { AuthenticatedClient } from './client-jwt.strategy';
import { PortalService } from './portal.service';
import { PortalConsignmentDto } from './dto/portal.dto';

/**
 * El portal del propietario.
 *
 * `@Public()` desactiva el guard de asesores; `ClientAuthGuard` es quien manda
 * aqui. Ninguna ruta recibe un identificador de cliente: el unico que existe es
 * el del token.
 */
@ApiTags('portal')
@Public()
@UseGuards(ClientAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly publicService: PublicService,
    private readonly storage: StorageService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil del propietario y su asesor' })
  me(@CurrentClient() client: AuthenticatedClient) {
    return this.portal.profile(client.id);
  }

  @Get('properties')
  @ApiOperation({ summary: 'Sus inmuebles' })
  properties(@CurrentClient() client: AuthenticatedClient) {
    return this.portal.properties(client.id);
  }

  @Get('visits')
  @ApiOperation({ summary: 'Visitas a sus inmuebles' })
  visits(@CurrentClient() client: AuthenticatedClient) {
    return this.portal.visits(client.id);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Sus solicitudes de consignación y su estado' })
  requests(@CurrentClient() client: AuthenticatedClient) {
    return this.portal.requests(client.id, client.email || null);
  }

  @Post('consignments')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @UseInterceptors(
    FileFieldsInterceptor([
      ...DOCUMENT_FIELDS.map((field) => ({ name: field.name, maxCount: 1 })),
      { name: 'photos', maxCount: 20 },
    ]),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: PortalConsignmentDto })
  @ApiOperation({
    summary: 'Propone otro inmueble, ya identificado',
    description:
      'Los datos del propietario salen de la sesión, no del formulario: quien ' +
      'está dentro no vuelve a teclear su nombre, y no puede enviar una ' +
      'solicitud a nombre de otro.',
  })
  async createConsignment(
    @CurrentClient() client: AuthenticatedClient,
    @Body() dto: PortalConsignmentDto,
    @Req() req: Request,
    @UploadedFiles()
    uploaded?: Record<string, Express.Multer.File[] | undefined>,
  ) {
    const profile = await this.portal.profile(client.id);

    /*
     * Los datos del propietario se sobrescriben con los de la sesion. Aunque el
     * DTO los declare, lo que llegue en el cuerpo se descarta: si no, un
     * cliente autenticado podria consignar a nombre de cualquiera.
     */
    const request = await this.publicService.createConsignment(
      {
        ...dto,
        ownerFirstName: profile.firstName,
        ownerLastName: profile.lastName ?? '',
        ownerEmail: profile.email ?? '',
        ownerPhone: profile.cellPhone ?? '',
      },
      req.ip,
      client.id,
    );

    const files = await storeConsignmentFiles(
      this.storage,
      request.id,
      uploaded,
    );
    if (files.length) await this.publicService.attachFiles(request.id, files);

    return {
      reference: request.reference,
      message:
        'Recibimos tu inmueble. Un asesor lo revisa y te avisa cuando quede publicado.',
      files: files.length,
    };
  }
}
