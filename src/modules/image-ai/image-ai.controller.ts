import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import {
  GateProfile,
  DEFAULT_RULES,
  GateCode,
  GateSeverity,
} from '../media/image-gate.rules';
import { ROOM_LABEL, RoomKind } from './domain/image-analysis.enums';
import { GateSettingsService } from '../media/gate-settings.service';
import { ImageAnalysisService } from './image-analysis.service';
import { PropuestaService } from './propuesta.service';
import { ImageRetouchService } from './image-retouch.service';
import { RETOUCH_KIND_LABEL } from './domain/image-retouch.enums';
import { RetouchDto, RetouchPreviewDto } from './dto/image-retouch.dto';
import { huellaPrompt, ImagePromptService } from './image-prompt.service';
import { SamplesService } from './samples.service';
import {
  AnalyzePropertyDto,
  RecortarImagenDto,
  CreateSamplesDto,
  ReviewPrivacyDto,
  SavePromptDto,
  UpdateGateRulesDto,
} from './dto/image-ai.dto';

/**
 * El panel del modulo de imagenes.
 *
 * TODO lo de aqui exige sesion del equipo. No hay ni una ruta `@Public()`, y
 * eso no es un descuido de configuracion: es el requisito. El cliente que manda
 * una solicitud de consignacion desde la web pasa por la puerta de codigo —que
 * no cuesta nada— y no toca esto por ningun sitio. La IA la ejecuta quien usa
 * la plataforma, y cada pulsacion es una factura.
 *
 * El reparto de roles sigue el del resto: analizar es trabajo de asesor, y
 * mover los umbrales o el prompt es configuracion, o sea ADMIN. Cambiar el
 * prompt cambia lo que el modelo contesta en toda la agencia; no es una
 * preferencia personal.
 */
@ApiTags('image-ai')
@Controller('image-ai')
export class ImageAiController {
  constructor(
    private readonly analysis: ImageAnalysisService,
    private readonly propuestas: PropuestaService,
    private readonly prompts: ImagePromptService,
    private readonly gate: GateSettingsService,
    private readonly samples: SamplesService,
    private readonly retouch: ImageRetouchService,
  ) {}

  // --- estado ---------------------------------------------------------------

  @Get('status')
  @ApiOperation({
    summary: 'Si el analisis esta disponible y con que se ejecuta',
    description:
      'Sin clave del proveedor, `enabled` es falso y el panel puede esconder el boton en lugar de dejar que el asesor pulse y reciba un 503.',
  })
  async status() {
    const prompt = await this.prompts.active();
    return {
      enabled: this.analysis.available,
      promptVersion: prompt.version,
      /*
        La huella del texto activo. El panel la compara con la que trae cada
        resultado y contesta sin ambiguedad "esto salio del prompt de ahora" o
        "esto es de otro texto" — que con el numero de version solo no se puede
        distinguir de "se aplico y no movio nada".
      */
      promptHash: huellaPrompt(prompt.body),
      /*
        El techo de fotos por lote, para que el boton del panel prometa las que
        de verdad se van a analizar.

        Sale de aqui y no de una constante en el panel porque `IMAGE_AI_MAX_IMAGES`
        se configura entre 1 y 40: el dia que alguien lo baje a 10 para contener
        el gasto, un panel con el 20 escrito a mano diria "analizar 20 fotos" y
        se analizarian 10. Un numero que decide lo que se cobra no puede vivir
        en dos sitios, porque el dia que dejen de coincidir nada avisa.
      */
      maxImages: this.analysis.maxImages,
      // La clave NO sale de aqui ni en parte. Lo unico que se dice es si hay.
      rooms: Object.values(RoomKind).map((value) => ({
        value,
        label: ROOM_LABEL[value],
      })),
      gateCodes: Object.values(GateCode),
      severities: Object.values(GateSeverity),
      /*
        El retoque va aparte del analisis y con su propia bandera: son dos
        gastos de distinto orden y la agencia puede querer uno sin el otro.
        Apagado, el panel esconde el boton en vez de dejar pulsar y dar 503.
      */
      retouch: {
        enabled: this.retouch.available,
        kinds: Object.entries(RETOUCH_KIND_LABEL).map(([value, label]) => ({
          value,
          label,
        })),
      },
    };
  }

  // --- retoque con IA -------------------------------------------------------
  //
  // Nada de aqui es publico y nada de aqui es automatico. Una foto, una
  // pulsacion, una persona. Y lo que sale NO sustituye a la foto del anuncio
  // hasta que alguien lo mira y lo acepta.

  @Post('retouch/preview')
  @ApiOperation({
    summary: 'Que haria esta instruccion, sin hacerla',
    description:
      'No llama al modelo y no cuesta nada: clasifica el texto y devuelve si es un revelado o una alteracion de la realidad, la advertencia que hay que enseñar y el coste orientativo. Existe para que el aviso llegue MIENTRAS se escribe y no despues de cobrar.',
  })
  previewRetouch(@Body() dto: RetouchPreviewDto) {
    return this.retouch.previsualizar(dto.instruction);
  }

  @Get('images/:id/retouches')
  @ApiOperation({
    summary: 'Los retoques de una foto',
    description:
      'Incluye los descartados y los fallidos: cada intento se pago, y una lista que solo enseña los aciertos no sirve para saber lo que cuesta la funcion.',
  })
  listRetouches(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.listarPorImagen(id, actor);
  }

  @Post('images/:id/retouch')
  @ApiOperation({
    summary: 'Retocar UNA foto con IA',
    description:
      'Llama al modelo y se cobra (entre 5 y 18 centavos de dolar por foto, unas cien veces el analisis). Deja el resultado PENDIENTE: la foto del anuncio NO cambia hasta que alguien la mire y la acepte. Si la instruccion altera la escena en vez de revelarla, hace falta confirmarlo con `alteracionAsumida`.',
  })
  createRetouch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetouchDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.retocar(id, dto, actor);
  }

  @Post('retouches/:id/apply')
  @ApiOperation({
    summary: 'Aceptar un retoque: pasa a ser la foto del anuncio',
    description:
      'Cambia las urls de la foto y la deja MARCADA como retocada con IA, apuntando a esta fila. El original no se borra: se guarda entero para poder volver.',
  })
  applyRetouch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.aplicar(id, actor);
  }

  @Post('retouches/:id/discard')
  @ApiOperation({
    summary: 'Descartar un retoque',
    description:
      'Borra los ficheros del candidato, que no los ha visto nadie. La fila se queda con lo que se pidio y lo que costo.',
  })
  discardRetouch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.descartar(id, actor);
  }

  @Post('retouches/:id/revert')
  @ApiOperation({
    summary: 'Volver a la foto real',
    description:
      'Devuelve el original al anuncio y quita la marca. No cuesta nada: los ficheros nunca se fueron.',
  })
  revertRetouch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.revertir(id, actor);
  }

  @Get('properties/:id/retouch-summary')
  @ApiOperation({
    summary:
      'Cuanto se ha gastado en retocar un inmueble y cuantas fotos ya no son fotos',
  })
  retouchSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.retouch.resumenPorInmueble(id, actor);
  }

  // --- analisis -------------------------------------------------------------

  @Get('properties/:id')
  @ApiOperation({
    summary: 'Lo ya analizado de un inmueble',
    description:
      'No llama al modelo ni cuesta nada: solo lee lo guardado. `stale` avisa de que se hizo con otro prompt u otro modelo.',
  })
  findForProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.analysis.findForProperty(id, actor);
  }

  @Post('properties/:id/analyze')
  @ApiOperation({
    summary: 'Analizar las fotos de un inmueble',
    description:
      'Esto SI llama al modelo y se paga por imagen. Salta lo ya analizado con el mismo prompt y el mismo modelo salvo que se pida `force`.',
  })
  analyze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnalyzePropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.analysis.analyzeProperty(id, actor, {
      imageIds: dto.imageIds,
      force: dto.force,
    });
  }

  @Patch('analyses/:id/privacy')
  @ApiOperation({
    summary: 'Marcar una alerta de datos personales como revisada',
    description:
      'Guarda quien la revisa y cuando, no solo el booleano: lo util dentro de seis meses no es que se descartara, es quien dijo que no era nada. El asesor sale del token. Reabrirla borra la firma, porque una marca reabierta esta sin revisar.',
  })
  reviewPrivacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPrivacyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.analysis.reviewPrivacy(id, dto.dismissed, actor);
  }

  // --- la propuesta de retoque ----------------------------------------------

  @Get('propuesta/properties/:id')
  @ApiOperation({
    summary: 'Que se le haria a cada foto de un inmueble',
    description:
      'No llama al modelo ni cuesta nada: traduce lo ya analizado. Cada sugerencia trae `destino`: AUTO es lo que el sistema puede aplicar solo —y solo entra ahi lo que el codigo ha confirmado midiendo los pixeles—, REVISITA es lo que obliga a volver a la casa o a que alguien mire la foto.',
  })
  propuesta(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.propuestas.porInmueble(id, actor);
  }

  @Post('propuesta/properties/:id')
  @ApiOperation({
    summary: 'Analizar y devolver la propuesta',
    description:
      'Esto SI llama al modelo y se paga por imagen: son unos 0,00074 USD por foto. Salta lo ya analizado con el mismo prompt y el mismo modelo salvo que se pida `force`.',
  })
  generarPropuesta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnalyzePropertyDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.propuestas.analizar(id, actor, {
      imageIds: dto.imageIds,
      force: dto.force,
    });
  }

  @Post('images/:id/crop')
  @ApiOperation({
    summary: 'Recortar una foto con los cortes que alguien ha aceptado',
    description:
      'Los cortes van en el cuerpo y no se recalculan aqui: en la pantalla se pueden aceptar unos y otros no. Una lista vacia deshace el recorte y devuelve la foto entera. Se parte siempre del negativo, asi que no acumula y no pierde el revelado.',
  })
  recortar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecortarImagenDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.propuestas.recortar(id, dto.cortes, actor);
  }

  // --- el prompt ------------------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('prompt')
  @ApiOperation({
    summary: 'La version activa del prompt y el texto de fabrica',
  })
  async activePrompt() {
    const active = await this.prompts.active();
    return {
      active,
      hash: huellaPrompt(active.body),
      repositoryDefault: this.prompts.defaultBody(),
    };
  }

  @Roles(Role.ADMIN)
  @Get('prompt/history')
  @ApiOperation({
    summary: 'Todas las versiones, de la mas nueva a la mas vieja',
    description:
      'Cada analisis guarda el numero de version con el que salio, asi que esta lista es lo que permite decir si un cambio mejoro o empeoro.',
  })
  async history() {
    const versiones = await this.prompts.list();
    // Cada version con la huella de SU texto: es lo que permite cotejar una
    // fila de resultados con la version que dice haberla producido.
    return versiones.map((v) => ({ ...v, hash: huellaPrompt(v.body) }));
  }

  @Roles(Role.ADMIN)
  @Post('prompt')
  @ApiOperation({
    summary: 'Guardar una version nueva y activarla',
    description:
      'No sobrescribe: la anterior se queda y se puede volver a ella por su numero.',
  })
  savePrompt(
    @Body() dto: SavePromptDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.prompts.create(dto.body, dto.notes ?? null, actor.id);
  }

  @Roles(Role.ADMIN)
  @Put('prompt/:version/activate')
  @ApiOperation({ summary: 'Volver a una version anterior' })
  activatePrompt(@Param('version', ParseIntPipe) version: number) {
    return this.prompts.activate(version);
  }

  @Roles(Role.ADMIN)
  @Post('prompt/restore-default')
  @ApiOperation({
    summary: 'Volver al prompt del repositorio',
    description:
      'Crea una version nueva con el texto de fabrica; no borra el historial.',
  })
  restoreDefault(@CurrentUser() actor: AuthenticatedActor) {
    return this.prompts.create(
      this.prompts.defaultBody(),
      'Restaurado el prompt del repositorio',
      actor.id,
    );
  }

  // --- la puerta de codigo --------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('gate')
  @ApiOperation({
    summary: 'Los umbrales de los dos perfiles',
    description:
      'Devuelve el valor de fabrica y el efectivo de cada uno, y cuales se han tocado.',
  })
  gateRules() {
    return this.gate.describe();
  }

  @Roles(Role.ADMIN)
  @Put('gate/:profile')
  @ApiOperation({
    summary: 'Cambiar umbrales de un perfil',
    description:
      'Un umbral en null vuelve al valor del repositorio. INVENTORY es lo que sube el equipo; REQUEST es lo que manda un propietario desde el movil, y ahi el liston alto cuesta clientes.',
  })
  updateGate(
    @Param('profile') profile: string,
    @Body() dto: UpdateGateRulesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.gate.update(this.perfil(profile), dto.rules, actor.id);
  }

  @Roles(Role.ADMIN)
  @Delete('gate/:profile')
  @ApiOperation({
    summary: 'Devolver un perfil a los umbrales del repositorio',
  })
  resetGate(@Param('profile') profile: string) {
    return this.gate.reset(this.perfil(profile));
  }

  // --- inmuebles de muestra -------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('samples')
  @ApiOperation({ summary: 'Los inmuebles de muestra que hay ahora' })
  listSamples() {
    return this.samples.list();
  }

  @Roles(Role.ADMIN)
  @Post('samples')
  @ApiOperation({
    summary: 'Crear inmuebles de muestra, sin publicar',
    description:
      'Quedan en borrador, marcados con `isSample` y con el codigo empezando por DEMO-. La base impide que salgan de borrador, asi que no pueden aparecer en la web.',
  })
  createSamples(
    @Body() dto: CreateSamplesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.samples.create(dto.count ?? 3, actor);
  }

  @Roles(Role.ADMIN)
  @Delete('samples')
  @ApiOperation({
    summary: 'Borrar todos los de muestra',
    description:
      'Filtra por `isSample`, que ningun inmueble real tiene. No acepta ids desde fuera a proposito.',
  })
  removeSamples() {
    return this.samples.removeAll();
  }

  private perfil(valor: string): GateProfile {
    const arriba = valor.toUpperCase();
    if (!(arriba in DEFAULT_RULES)) {
      throw new BadRequestException(
        `Perfil "${valor}" desconocido. Los que hay: ${Object.keys(DEFAULT_RULES).join(', ')}.`,
      );
    }
    return arriba as GateProfile;
  }
}
