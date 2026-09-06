import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../iam/decorators';
import {
  DOCUMENT_FIELDS,
  storeConsignmentFiles,
} from '../public/consignment-files';
import { streamConsignmentDocument } from '../public/consignment-documents';

import { PublicService } from '../public/public.service';
import { StorageService } from '../media/storage.service';
import { ImageGateService } from '../media/image-gate.service';
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
  private readonly logger = new Logger(PortalController.name);

  constructor(
    private readonly portal: PortalService,
    private readonly publicService: PublicService,
    private readonly storage: StorageService,
    private readonly gate: ImageGateService,
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

  @Get('requests/:id/documents/:index')
  @ApiOperation({
    summary: 'Descarga un documento que él mismo subió',
    description:
      'Solo de sus propias solicitudes. Una que no sea suya devuelve 404, no ' +
      '403: decir "existe pero no es tuya" ya es contar algo.',
  })
  async document(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const request = await this.portal.ownRequest(
      client.id,
      client.email || null,
      id,
    );
    return streamConsignmentDocument(this.storage, request, index, res);
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

    const { files, notes } = await storeConsignmentFiles(
      this.storage,
      this.gate,
      request.id,
      uploaded,
    );
    if (files.length) await this.publicService.attachFiles(request.id, files);

    /*
      Al propietario se le da las gracias y punto.

      Los avisos de la puerta —"esta vertical", "salio oscura"— NO se le
      devuelven: son para el asesor que revisa la solicitud. Devolverselos a
      quien acaba de mandar las fotos de su casa convierte un "gracias, te
      llamamos" en una lista de reproches, y esta persona no esta publicando un
      anuncio: esta preguntando si le interesa a la agencia.
    */
    if (notes.length) {
      this.logger.log(
        `Solicitud ${request.reference}: ${notes.length} avisos sobre las fotos`,
      );
    }

    return {
      reference: request.reference,
      message:
        'Recibimos tu inmueble. Un asesor lo revisa y te avisa cuando quede publicado.',
      files: files.length,
    };
  }
}
