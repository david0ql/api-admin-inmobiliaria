import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatConversation } from './domain/chat-conversation.entity';
import { ChatMessage } from './domain/chat-message.entity';
import { ChatReview } from './domain/chat-review.entity';
import { CHAT_ISSUE_LABEL, RuleSource } from './domain/chat.enums';
import { OpenAiProvider } from './openai-provider';
import { RulesService } from './rules.service';
import type { CreateReviewDto } from './dto/assistant.dto';

/** Cuánto hilo se le enseña al modelo para redactar la corrección. */
const CONTEXT_TURNS = 8;

/**
 * La calificación de una respuesta, y la regla que sale de ella.
 *
 * El circuito es: alguien lee una conversación, marca qué falló y explica qué
 * habría estado bien; el modelo convierte eso en una instrucción; y una persona
 * decide si la instrucción entra o no.
 *
 * Ese último paso es el importante. Dejar que el asistente se reescriba solo a
 * partir de sus propios fallos es como pedirle que se corrija el examen: en dos
 * semanas el prompt está lleno de reglas que nadie escribió y que se
 * contradicen. Aquí el modelo propone y una persona firma.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(ChatReview)
    private readonly reviews: Repository<ChatReview>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    private readonly provider: OpenAiProvider,
    private readonly rules: RulesService,
  ) {}

  listFor(conversationId: string): Promise<ChatReview[]> {
    return this.reviews.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      relations: { reviewedBy: true },
    });
  }

  /**
   * Guarda la calificación y pide al modelo una regla que evite el fallo.
   *
   * La regla NO se aplica aquí: se guarda como propuesta. Aplicarla es otro
   * gesto, deliberado, del panel.
   */
  async create(
    conversationId: string,
    dto: CreateReviewDto,
    agentId: string,
  ): Promise<ChatReview> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation)
      throw new NotFoundException('Conversación no encontrada');

    const suggestedRule = await this.redactarRegla(conversationId, dto);

    return this.reviews.save(
      this.reviews.create({
        conversationId,
        messageId: dto.messageId ?? null,
        issues: dto.issues,
        comment: dto.comment.trim(),
        suggestedRule,
        reviewedByAgentId: agentId,
      }),
    );
  }

  /** Aprueba la propuesta —tal cual o retocada— y la convierte en regla. */
  async apply(reviewId: string, text?: string): Promise<ChatReview> {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Calificación no encontrada');

    const final = (text ?? review.suggestedRule ?? '').trim();
    if (!final) throw new NotFoundException('No hay ninguna regla que aplicar');

    const regla = await this.rules.create(final, RuleSource.REVIEW, reviewId);
    await this.reviews.update({ id: reviewId }, { appliedRuleId: regla.id });

    return (await this.reviews.findOne({ where: { id: reviewId } }))!;
  }

  /**
   * Le pide al modelo UNA instrucción, corta y accionable.
   *
   * Se le enseña el final del hilo porque una respuesta mala casi nunca se
   * entiende sola: "no entendió lo que le pedían" solo tiene sentido viendo qué
   * le pidieron.
   *
   * Si esto falla, la calificación se guarda igual sin propuesta. Lo que no
   * puede perderse es lo que escribió la persona; la redacción automática es
   * una ayuda, no el motivo de estar aquí.
   */
  private async redactarRegla(
    conversationId: string,
    dto: CreateReviewDto,
  ): Promise<string | null> {
    try {
      const turnos = await this.messages.find({
        where: { conversationId },
        order: { position: 'DESC' },
        take: CONTEXT_TURNS,
      });

      const hilo = turnos
        .reverse()
        .map(
          (m) =>
            `${m.role === 'user' ? 'Visitante' : 'Asistente'}: ${m.content}`,
        )
        .join('\n');

      const fallos = dto.issues
        .map((issue) => CHAT_ISSUE_LABEL[issue] ?? issue)
        .join(', ');

      let salida = '';
      for await (const evento of this.provider.stream({
        messages: [
          {
            role: 'system',
            content: [
              'Eres quien entrena al asistente de una inmobiliaria colombiana.',
              'Te dan una conversación real, qué falló y qué opina quien la revisó.',
              'Devuelves UNA sola instrucción para el asistente, en español, en imperativo y en segunda persona ("Cuando... di..." / "No hagas...").',
              'Máximo 240 caracteres. Sin preámbulo, sin comillas, sin numerar: solo la instrucción.',
              'Que sea general —una norma que sirva la próxima vez— y no el arreglo de este caso concreto.',
              'No inventes datos del inventario ni politicas de la agencia que nadie te ha dicho.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              'CONVERSACIÓN:',
              hilo || '(sin mensajes)',
              '',
              `QUÉ FALLÓ: ${fallos || 'sin marcar'}`,
              `QUIEN REVISÓ DICE: ${dto.comment.trim()}`,
            ].join('\n'),
          },
        ],
        tools: [],
      })) {
        if (evento.type === 'text') salida += evento.delta;
      }

      return salida.trim().slice(0, 240) || null;
    } catch (error) {
      this.logger.warn(
        `No se pudo redactar la regla: ${error instanceof Error ? error.message : 'error'}`,
      );
      return null;
    }
  }
}
