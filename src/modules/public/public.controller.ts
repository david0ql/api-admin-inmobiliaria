import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../iam/decorators';
import { AllowPendingPassword } from '../iam/guards/must-change-password.guard';
import { CatalogService } from '../catalog/catalog.service';
import { StorageService } from '../media/storage.service';
import { PublicService } from './public.service';
import { CaptchaService } from './captcha.service';
import { BookVisitDto, CreateConsignmentDto } from './dto/consignment.dto';
import { SearchPublicProjectsDto } from './dto/public-projects.dto';
import { SearchPublicPropertiesDto } from './dto/public-search.dto';
import type { ConsignmentFile } from './domain/consignment-request.entity';

/**
 * Superficie publica: lo que consume la web de presentacion.
 *
 * Todo va sin token y con limite de trafico. Solo se expone lo publicado y
 * nunca datos internos — ni etapa del embudo, ni notas, ni cartera.
 *
 * La unica excepcion es la tarjeta de contacto del asesor a cargo en la ficha,
 * y va recortada a mano a nombre, correo, movil y foto: es informacion que la
 * agencia ya publica en cada anuncio. Ver `publicAgent` en PublicService.
 */
@ApiTags('public')
@Public()
@AllowPendingPassword()
@Controller('public')
export class PublicController {
  constructor(
    private readonly service: PublicService,
    private readonly captcha: CaptchaService,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
  ) {}

  // --- inmuebles ---------------------------------------------------------

  @Get('properties')
  @ApiOperation({ summary: 'Inmuebles publicados y disponibles' })
  searchProperties(@Query() dto: SearchPublicPropertiesDto) {
    return this.service.searchProperties(dto);
  }

  @Get('properties/:code')
  @ApiOperation({ summary: 'Ficha publica por codigo' })
  property(@Param('code') code: string) {
    return this.service.propertyByCode(code);
  }

  @Get('properties/:code/siblings')
  @ApiOperation({
    summary: 'Otras unidades del mismo proyecto',
    description: 'El mismo conjunto con otra medida, otro piso u otro precio.',
  })
  async siblings(@Param('code') code: string) {
    const property = await this.service.propertyByCode(code);
    return this.service.siblingsOf(property.id);
  }

  // --- proyectos ---------------------------------------------------------

  @Get('projects')
  @ApiOperation({
    summary: 'Proyectos y conjuntos',
    description:
      'Cada uno con sus tipologias, unidades disponibles y precio desde.',
  })
  projects(@Query() dto: SearchPublicProjectsDto) {
    return this.service.listFamilies(dto);
  }

  @Get('projects/:slug')
  @ApiOperation({ summary: 'Proyecto con sus tipologias y unidades' })
  project(@Param('slug') slug: string) {
    return this.service.familyBySlug(slug);
  }

  // --- catalogos para los filtros ----------------------------------------

  @Get('catalogs')
  @ApiOperation({ summary: 'Lo que necesita el buscador de la web' })
  async catalogs() {
    const [cities, propertyTypes, features] = await Promise.all([
      this.catalog.listCities(),
      this.catalog.listPropertyTypes(),
      this.catalog.listFeatures(),
    ]);
    return { cities, propertyTypes, features };
  }

  @Get('catalogs/zones')
  @ApiQuery({ name: 'cityId', required: false, type: Number })
  @ApiOperation({
    summary: 'Barrios, para el segundo desplegable del buscador',
    description:
      'Sin `cityId` devuelve todos, que son varios miles: la web pide los de la ciudad elegida.',
  })
  zones(
    @Query('cityId', new ParseIntPipe({ optional: true })) cityId?: number,
  ) {
    return this.catalog.listZones(cityId);
  }

  @Get('catalogs/counts')
  @ApiOperation({
    summary: 'Inmuebles publicados por tipo',
    description:
      'Lo que el menu de la web enseña entre parentesis: Apartamento (423).',
  })
  counts() {
    return this.service.countsByPropertyType();
  }

  // --- agenda ------------------------------------------------------------

  @Get('properties/:code/availability')
  @ApiQuery({ name: 'from', required: true, example: '2026-08-05' })
  @ApiQuery({ name: 'to', required: true, example: '2026-08-20' })
  @ApiOperation({
    summary: 'Dias con asesor disponible para visitar el inmueble',
    description:
      'Devuelve, dia a dia, las franjas en que queda al menos un asesor libre ' +
      'segun su cuadro de turnos y las citas ya agendadas.',
  })
  availability(
    @Param('code') code: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.availabilityFor(code, from, to);
  }

  @Post('visits')
  // Agendar es una escritura abierta: se limita fuerte.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reserva una visita',
    description:
      'Crea el cliente si no existe, lo vincula al inmueble y asigna al asesor ' +
      'libre con menos carga ese dia.',
  })
  async bookVisit(@Body() dto: BookVisitDto, @Req() req: Request) {
    await this.captcha.verify(dto.captchaToken, ip(req));
    return this.service.bookVisit(dto, ip(req));
  }

  // --- consignaciones ----------------------------------------------------

  @Post('consignments')
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'documents', maxCount: 5 },
      { name: 'photos', maxCount: 20 },
    ]),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    description:
      'Datos del formulario mas `documents` (hasta 5 PDF) y `photos`. ' +
      'Si no se envian ficheros vale JSON plano.',
    type: CreateConsignmentDto,
  })
  @ApiOperation({ summary: 'Propone un inmueble para consignacion' })
  async createConsignment(
    @Body() dto: CreateConsignmentDto,
    @Req() req: Request,
    @UploadedFiles()
    uploaded?: {
      documents?: Express.Multer.File[];
      photos?: Express.Multer.File[];
    },
  ) {
    await this.captcha.verify(dto.captchaToken, ip(req));
    const request = await this.service.createConsignment(dto, ip(req));

    // Las fotos pasan por el mismo procesado que el inventario; los documentos
    // se guardan tal cual, que un PDF no se recomprime.
    const files: ConsignmentFile[] = [];
    for (const photo of uploaded?.photos ?? []) {
      const stored = await this.storage
        .saveImage(
          photo.buffer,
          `consignments/${request.id}`,
          photo.originalname,
        )
        .catch(() => null);
      if (stored) {
        files.push({
          kind: 'PHOTO',
          storageKey: stored.key,
          url: stored.url,
          originalName: photo.originalname,
          bytes: stored.bytes,
        });
      }
    }
    for (const document of uploaded?.documents ?? []) {
      const stored = await this.storage
        .saveRaw(
          document.buffer,
          `consignments/${request.id}`,
          document.originalname,
        )
        .catch(() => null);
      if (stored) {
        files.push({
          kind: 'DOCUMENT',
          storageKey: stored.key,
          url: stored.url,
          originalName: document.originalname,
          bytes: stored.bytes,
        });
      }
    }

    if (files.length) await this.service.attachFiles(request.id, files);

    return {
      reference: request.reference,
      message:
        'Recibimos tu solicitud. Un asesor la revisara y te contactara para coordinar la visita.',
      files: files.length,
    };
  }

  @Get('consignments/:reference')
  @ApiOperation({ summary: 'Estado de una solicitud, para el propietario' })
  async consignment(@Param('reference') reference: string) {
    const request = await this.service.consignmentByReference(reference);
    // Solo lo que el propietario necesita saber: nada de la gestion interna.
    return {
      reference: request.reference,
      status: request.status,
      address: request.address,
      complexName: request.complexName,
      requestedVisitAt: request.requestedVisitAt,
      resolution: request.resolution,
      createdAt: request.createdAt,
    };
  }

  @Get('consignments/:id/availability')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOperation({ summary: 'Dias libres para la visita de valoracion' })
  consignmentAvailability(
    @Param('id', ParseUUIDPipe) _id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.teamAvailability(from, to);
  }
}

function ip(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}
