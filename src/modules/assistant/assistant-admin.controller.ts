import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../iam/decorators';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { Role } from '../iam/domain/role.enum';
import { ConversationsService } from './conversations.service';
import { ReviewsService } from './reviews.service';
import { RulesService } from './rules.service';
import { CHAT_ISSUE_LABEL } from './domain/chat.enums';
import {
  ApplyRuleDto,
  CreateReviewDto,
  CreateRuleDto,
  PostPromptDto,
  UpdateRuleDto,
} from './dto/assistant.dto';

/**
 * El histórico del chat y lo que se aprende de él.
 *
 * Todo aquí es de ADMIN. Una conversación lleva el nombre, el teléfono y el
 * correo de quien escribió, y a veces lo que puede pagar: es la cartera de la
 * agencia leída de otra forma, y no toca a todo el equipo. Las reglas, además,
 * cambian lo que el asistente le dice a cualquiera que entre en la web.
 */
@ApiTags('assistant')
@Roles(Role.ADMIN)
@Controller('assistant')
export class AssistantAdminController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly reviews: ReviewsService,
    private readonly rules: RulesService,
  ) {}

  // --- conversaciones -----------------------------------------------------

  @Get('conversations')
  @ApiOperation({ summary: 'Histórico de conversaciones, con filtros' })
  list(
    @Query('q') q?: string,
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('clientId') clientId?: string,
    @Query('reviewed') reviewed?: 'yes' | 'no',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.search({
      q,
      name,
      email,
      phone,
      clientId,
      reviewed,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('clients/:clientId/thread')
  @ApiOperation({
    summary: 'Todo lo que un cliente ha hablado, en un solo hilo',
  })
  async thread(@Param('clientId') clientId: string) {
    const [thread, reviews] = await Promise.all([
      this.conversations.threadFor(clientId),
      this.reviews.listForClient(clientId),
    ]);
    return { ...thread, reviews };
  }

  @Get('conversations/:id')
  @ApiOperation({
    summary: 'Una conversación con su hilo y sus calificaciones',
  })
  async detail(@Param('id') id: string) {
    const [conversation, reviews] = await Promise.all([
      this.conversations.findOne(id),
      this.reviews.listFor(id),
    ]);
    return { ...conversation, reviews };
  }

  // --- calificaciones -----------------------------------------------------

  @Get('issues')
  @ApiOperation({ summary: 'Los motivos de fallo, con su etiqueta' })
  issues() {
    return Object.entries(CHAT_ISSUE_LABEL).map(([value, label]) => ({
      value,
      label,
    }));
  }

  @Post('conversations/:id/reviews')
  @ApiOperation({
    summary: 'Califica una respuesta; el modelo propone cómo corregirla',
  })
  review(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.reviews.create(id, dto, actor.id);
  }

  @Post('reviews/:id/apply')
  @ApiOperation({ summary: 'Convierte la propuesta en una regla activa' })
  apply(@Param('id') id: string, @Body() dto: ApplyRuleDto) {
    return this.reviews.apply(id, dto.text);
  }

  // --- reglas y post-prompt ----------------------------------------------

  @Get('rules')
  @ApiOperation({ summary: 'Las reglas que se le añaden al asistente' })
  listRules() {
    return this.rules.list();
  }

  @Post('rules')
  createRule(@Body() dto: CreateRuleDto) {
    return this.rules.create(dto.text);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return this.rules.update(id, dto);
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string) {
    return this.rules.remove(id);
  }

  @Get('settings')
  @ApiOperation({ summary: 'El texto libre que va al final del prompt' })
  settings() {
    return this.rules.getSettings();
  }

  @Put('settings')
  setPostPrompt(@Body() dto: PostPromptDto) {
    return this.rules.setPostPrompt(dto.postPrompt);
  }
}
