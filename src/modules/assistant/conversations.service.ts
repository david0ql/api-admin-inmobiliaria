import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { normalizePhone } from '../crm/clients.service';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { Client } from '../crm/domain/client.entity';
import { PipelinesService } from '../crm/pipelines.service';
import { ChatConversation } from './domain/chat-conversation.entity';
import { ChatMessage } from './domain/chat-message.entity';
import type { IdentifyDto } from './dto/assistant.dto';

/** Cómo se llama la fuente de estos leads en el embudo. */
const SOURCE_NAME = 'Chat web';

export interface ConversationFilters {
  q?: string;
  clientId?: string;
  reviewed?: 'yes' | 'no';
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/**
 * Las conversaciones del chat: quién habla, y qué se dijo.
 *
 * Guardar el hilo no es archivar por archivar. Es lo único que permite después
 * mirar una respuesta mala y decir qué falló; sin el texto delante, corregir al
 * asistente es adivinar.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
    @InjectRepository(LeadSource)
    private readonly sources: Repository<LeadSource>,
    private readonly pipelines: PipelinesService,
  ) {}

  /**
   * Identifica a quien va a escribir, y abre su conversación.
   *
   * Si el teléfono o el correo ya están en la cartera se reutiliza esa ficha:
   * un cliente que vuelve no puede acabar duplicado por escribir su nombre de
   * otra forma. Si no está, se crea — el chat es una puerta de entrada más, y
   * quien pregunta por un inmueble es un lead aunque nunca rellene un
   * formulario.
   *
   * Se saluda con el nombre que ACABA de escribir, nunca con el guardado. Con
   * el guardado, cualquiera que teclease un móvil ajeno sabría a quién
   * pertenece.
   */
  async identify(
    dto: IdentifyDto,
    ip?: string,
  ): Promise<{ conversationId: string; clientId: string; returning: boolean }> {
    const email = dto.email.trim().toLowerCase();
    const phoneNormalized = normalizePhone(dto.phone);

    const existing = await this.clients
      .createQueryBuilder('client')
      .where('LOWER(client.email) = :email', { email })
      .orWhere(
        phoneNormalized ? 'client.phone_normalized = :phone' : 'FALSE',
        phoneNormalized ? { phone: phoneNormalized } : {},
      )
      .getOne();

    const client = existing ?? (await this.crear(dto, email, phoneNormalized));

    const conversation = await this.conversations.save(
      this.conversations.create({
        clientId: client.id,
        propertyCode: dto.propertyCode ?? null,
        ipAddress: ip ?? null,
        lastMessageAt: new Date(),
        messageCount: 0,
      }),
    );

    return {
      conversationId: conversation.id,
      clientId: client.id,
      returning: Boolean(existing),
    };
  }

  private async crear(
    dto: IdentifyDto,
    email: string,
    phoneNormalized: string | null,
  ): Promise<Client> {
    // La primera etapa del embudo por defecto, igual que el formulario de
    // visitas: un lead del chat entra por la misma puerta que los demas.
    const pipeline = await this.pipelines.findDefault();
    const stage = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    // Se crea la primera vez si no existe. Sin esto los leads del chat entran
    // sin fuente y en el informe de atribucion no aparecen: el canal que los
    // trajo queda invisible justo cuando se quiere saber si vale la pena.
    const source =
      (await this.sources.findOne({ where: { name: SOURCE_NAME } })) ??
      (await this.sources.save(this.sources.create({ name: SOURCE_NAME })));

    return this.clients.save(
      this.clients.create({
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        cellPhone: dto.phone.trim(),
        phoneNormalized,
        pipelineId: pipeline.id,
        stageId: stage.id,
        stageChangedAt: new Date(),
        sourceId: source?.id ?? null,
      }),
    );
  }

  /** Añade un turno y mantiene al día los contadores del hilo. */
  async append(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    if (!content.trim()) return;

    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
      select: { id: true, messageCount: true },
    });
    if (!conversation) return;

    await this.messages.save(
      this.messages.create({
        conversationId,
        role,
        content: content.slice(0, 8000),
        position: conversation.messageCount,
      }),
    );

    await this.conversations.update(
      { id: conversationId },
      {
        messageCount: conversation.messageCount + 1,
        lastMessageAt: new Date(),
      },
    );
  }

  /** El listado del panel, con sus filtros. */
  async search(filters: ConversationFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const qb = this.conversations
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.client', 'client')
      // Con `count` en un left join la fila se duplica por cada calificación;
      // como subconsulta cuenta bien y no toca el resto de la consulta.
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(*)')
            .from('chat_review', 'review')
            .where('review.conversation_id = conversation.id'),
        'reviews',
      )
      .orderBy('conversation.last_message_at', 'DESC');

    if (filters.clientId) {
      qb.andWhere('conversation.client_id = :clientId', {
        clientId: filters.clientId,
      });
    }

    // Una sola caja para nombre, correo y telefono: quien busca no se para a
    // pensar en que campo esta lo que recuerda.
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim().toLowerCase()}%`;
      const digits = filters.q.replace(/\D/g, '');
      qb.andWhere(
        new Brackets((where) => {
          where
            .where(
              "LOWER(client.first_name || ' ' || COALESCE(client.last_name, '')) LIKE :q",
              { q },
            )
            .orWhere('LOWER(client.email) LIKE :q', { q });
          if (digits) {
            where.orWhere('client.phone_normalized LIKE :phone', {
              phone: `%${digits.slice(-10)}%`,
            });
          }
        }),
      );
    }

    if (filters.from) {
      qb.andWhere('conversation.last_message_at >= :from', {
        from: `${filters.from}T00:00:00-05:00`,
      });
    }
    if (filters.to) {
      qb.andWhere('conversation.last_message_at <= :to', {
        to: `${filters.to}T23:59:59-05:00`,
      });
    }
    if (filters.reviewed === 'yes') {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM chat_review r WHERE r.conversation_id = conversation.id)',
      );
    }
    if (filters.reviewed === 'no') {
      qb.andWhere(
        'NOT EXISTS (SELECT 1 FROM chat_review r WHERE r.conversation_id = conversation.id)',
      );
    }

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getRawAndEntities<{ reviews: string }>();

    const data = entities.map((conversation, index) => ({
      ...conversation,
      reviews: Number(raw[index]?.reviews ?? 0),
    }));

    return { data, meta: { page, limit, total } };
  }

  /** Una conversación con su hilo, para leerla entera. */
  async findOne(id: string) {
    const conversation = await this.conversations.findOne({
      where: { id },
      relations: { client: true },
    });
    if (!conversation)
      throw new NotFoundException('Conversación no encontrada');

    const messages = await this.messages.find({
      where: { conversationId: id },
      order: { position: 'ASC' },
    });

    return { ...conversation, messages };
  }
}
