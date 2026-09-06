import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { ImagePromptService } from './image-prompt.service';
import { SamplesService } from './samples.service';
import {
  AnalyzePropertyDto,
  CreateSamplesDto,
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
    private readonly prompts: ImagePromptService,
    private readonly gate: GateSettingsService,
    private readonly samples: SamplesService,
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
      // La clave NO sale de aqui ni en parte. Lo unico que se dice es si hay.
      rooms: Object.values(RoomKind).map((value) => ({
        value,
        label: ROOM_LABEL[value],
      })),
      gateCodes: Object.values(GateCode),
      severities: Object.values(GateSeverity),
    };
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

  // --- el prompt ------------------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('prompt')
  @ApiOperation({
    summary: 'La version activa del prompt y el texto de fabrica',
  })
  async activePrompt() {
    const active = await this.prompts.active();
    return { active, repositoryDefault: this.prompts.defaultBody() };
  }

  @Roles(Role.ADMIN)
  @Get('prompt/history')
  @ApiOperation({
    summary: 'Todas las versiones, de la mas nueva a la mas vieja',
    description:
      'Cada analisis guarda el numero de version con el que salio, asi que esta lista es lo que permite decir si un cambio mejoro o empeoro.',
  })
  history() {
    return this.prompts.list();
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
