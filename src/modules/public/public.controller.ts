import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../iam/decorators';
import { AllowPendingPassword } from '../iam/guards/must-change-password.guard';
import { CatalogService } from '../catalog/catalog.service';
import { PublicService } from './public.service';
import { CaptchaService } from './captcha.service';
import { BookVisitDto } from './dto/consignment.dto';
import { CreateCreditRequestDto } from './dto/credit.dto';
import { CreditRequestsService } from './credit-requests.service';
import { HomeSettingsService } from './home-settings.service';
import { PublicCache } from '../../shared/cache/public-cache.decorator';
import { PublicCacheInterceptor } from '../../shared/cache/public-cache.interceptor';
import { SearchPublicProjectsDto } from './dto/public-projects.dto';
import { ExchangeRateService } from './exchange-rate.service';
import { SearchPublicPropertiesDto } from './dto/public-search.dto';

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
@UseInterceptors(PublicCacheInterceptor)
@Controller('public')
export class PublicController {
  constructor(
    private readonly service: PublicService,
    private readonly captcha: CaptchaService,
    private readonly catalog: CatalogService,
    private readonly credits: CreditRequestsService,
    private readonly homeSettings: HomeSettingsService,
    private readonly fx: ExchangeRateService,
  ) {}

  // --- inmuebles ---------------------------------------------------------

  @PublicCache(300)
  @Get('home/showcase')
  @ApiOperation({
    summary: 'El carrusel de la portada, ya resuelto',
    description:
      'Los inmuebles que toque segun la configuracion, mas como debe moverse.',
  })
  showcase() {
    return this.homeSettings.showcase();
  }

  @Get('home/projects')
  @ApiOperation({
    summary: 'Los proyectos de la portada, rotando',
    description:
      'Salen de un grupo que se lee cada diez minutos y de sesenta ordenes ya hechos: cada peticion recibe otro sin consultar la base.',
  })
  homeProjects() {
    return this.service.homeProjects(6);
  }

  @PublicCache(300)
  @Get('properties')
  @ApiOperation({ summary: 'Inmuebles publicados y disponibles' })
  searchProperties(@Query() dto: SearchPublicPropertiesDto) {
    return this.service.searchProperties(dto);
  }

  @PublicCache(300)
  @Get('properties/:code')
  @ApiOperation({ summary: 'Ficha publica por codigo' })
  property(@Param('code') code: string) {
    return this.service.propertyByCode(code);
  }

  @PublicCache(300)
  /**
   * Suma una visita a la ficha.
   *
   * Aparte de leerla, para que la lectura se pueda cachear. Se limita fuerte:
   * es una escritura publica y lo unico que se juega es un contador.
   */
  @Post('properties/:code/visit')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @ApiOperation({ summary: 'Registra que alguien abrio la ficha' })
  async registerVisit(@Param('code') code: string): Promise<void> {
    await this.service.registerVisit(code);
  }

  @PublicCache(300)
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

  @PublicCache(300)
  @Get('projects')
  @ApiOperation({
    summary: 'Proyectos y conjuntos',
    description:
      'Cada uno con sus tipologias, unidades disponibles y precio desde.',
  })
  projects(@Query() dto: SearchPublicProjectsDto) {
    return this.service.listFamilies(dto);
  }

  @PublicCache(300)
  @Get('projects/:slug')
  @ApiOperation({ summary: 'Proyecto con sus tipologias y unidades' })
  project(@Param('slug') slug: string) {
    return this.service.familyBySlug(slug);
  }

  // --- catalogos para los filtros ----------------------------------------

  @PublicCache(300)
  @Get('catalogs')
  @ApiOperation({ summary: 'Lo que necesita el buscador de la web' })
  async catalogs() {
    const [cities, geo, propertyTypes, features] = await Promise.all([
      this.catalog.listCities(),
      // Aparte de `cities` a proposito. `geo` es solo donde HAY inventario y
      // alimenta el buscador; `cities` es el catalogo entero, que necesita
      // quien va a consignar un inmueble en una ciudad donde todavia no
      // tenemos ninguno.
      this.service.geography(),
      this.catalog.listPropertyTypes(),
      this.catalog.listFeatures(),
    ]);
    return { cities, geo, propertyTypes, features };
  }

  /*
    Media hora de cache: detras hay un servicio que solo pregunta dos veces al
    dia, pero esto evita ademas que cada visita a la portada entre al servicio.
  */
  @PublicCache(1800)
  @Get('fx/usd')
  @ApiOperation({
    summary: 'Cuantos pesos vale un dolar hoy',
    description:
      'TRM oficial de la Superfinanciera, con una fuente de mercado como respaldo. `null` si ninguna responde: la web esconde el conmutador en vez de inventarse una cifra.',
  })
  usd() {
    return this.fx.usd();
  }

  @PublicCache(300)
  @Get('catalogs/facets')
  @ApiOperation({
    summary: 'Cuantos inmuebles hay detras de cada opcion del buscador',
    description:
      'Acepta los mismos filtros que la busqueda. Cada desplegable se cuenta contra los DEMAS filtros y no contra si mismo, para que elegir una ciudad no deje a las otras en cero.',
  })
  facets(@Query() dto: SearchPublicPropertiesDto) {
    return this.service.facets(dto);
  }

  @PublicCache(300)
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

  @PublicCache(300)
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

  /*
    SIN cache. Los cupos cambian en cuanto alguien agenda, y ofrecer una hora ya
    tomada es peor que tardar 80 ms mas.
  */
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
  //
  // Aqui habia un `POST consignments` abierto, sin sesion y con captcha. Se
  // retira: la web pide cuenta antes de abrir el formulario, asi que ese
  // endpoint no lo llamaba ya nadie y quedaba como lo que era — una escritura
  // anonima que crea un cliente en la cartera y acepta ficheros, sin nadie
  // detras a quien preguntar. El captcha frena a un robot torpe, no a quien se
  // moleste en mirar.
  //
  // Las consignaciones entran ahora por `POST /portal/consignments`, que sabe
  // de quien es el inmueble porque lo dice la sesion y no el formulario.
  //
  // Las dos consultas de abajo se quedan: son de lectura y con una referencia
  // que solo tiene quien la envio.

  // --- creditos ----------------------------------------------------------

  @Post('credit-requests')
  // Mismo limite que consignaciones: son datos personales sensibles y no hay
  // motivo legitimo para enviar cuatro consultas en cinco minutos.
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @ApiOperation({
    summary: 'Consulta de viabilidad de credito hipotecario',
    description:
      'Es un lead, no una radicacion: no consulta centrales de riesgo ni ' +
      'aprueba nada. Deja el caso listo para que un asesor lo trabaje.',
  })
  async createCreditRequest(
    @Body() dto: CreateCreditRequestDto,
    @Req() req: Request,
  ) {
    await this.captcha.verify(dto.captchaToken, ip(req));
    const request = await this.credits.create(dto, ip(req));
    return {
      reference: request.reference,
      message:
        'Recibimos tu consulta. Un asesor revisara tu caso y te contactara para explicarte las opciones.',
    };
  }

  @Get('credit-requests/:reference')
  @ApiOperation({ summary: 'Estado de una consulta, para el solicitante' })
  async creditRequest(@Param('reference') reference: string) {
    const request = await this.credits.findByReference(reference);
    // Nada de la gestion interna: ni entidad, ni asesor, ni notas.
    return {
      reference: request.reference,
      status: request.status,
      amount: request.amount,
      termYears: request.termYears,
      createdAt: request.createdAt,
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
