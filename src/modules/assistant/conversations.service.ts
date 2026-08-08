import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, type SelectQueryBuilder } from 'typeorm';
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
  /** Caja unica: busca en nombre, correo y telefono a la vez. */
  q?: string;
  /** Y los tres por separado, para afinar. */
  name?: string;
  email?: string;
  phone?: string;
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

  /**
   * El listado del panel: una fila por CLIENTE, no por conversación.
   *
   * Una persona que vuelve tres veces generaba tres filas seguidas con el mismo
   * nombre, y quien revisa tenía que abrir las tres para entender una sola
   * historia. Agrupado se lee como lo que es: un cliente y todo lo que ha
   * hablado con nosotros.
   *
   * La agregación va en SQL y no en memoria: paginar en memoria obliga a traer
   * todas las conversaciones para poder contar clientes, y eso deja de
   * funcionar en cuanto haya unas miles.
   */
  async search(filters: ConversationFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const qb = this.conversations
      .createQueryBuilder('conversation')
      .innerJoin('conversation.client', 'client')
      .select('client.id', 'clientId')
      .addSelect('client.first_name', 'firstName')
      .addSelect('client.last_name', 'lastName')
      .addSelect('client.email', 'email')
      .addSelect('client.cell_phone', 'cellPhone')
      .addSelect('COUNT(DISTINCT conversation.id)', 'conversations')
      .addSelect('COALESCE(SUM(conversation.message_count), 0)', 'messages')
      .addSelect('MAX(conversation.last_message_at)', 'lastMessageAt')
      .addSelect(`COUNT(DISTINCT review.id)`, 'reviews')
      .leftJoin(
        'chat_review',
        'review',
        'review.conversation_id = conversation.id',
      )
      .groupBy('client.id')
      .addGroupBy('client.first_name')
      .addGroupBy('client.last_name')
      .addGroupBy('client.email')
      .addGroupBy('client.cell_phone')
      .orderBy('MAX(conversation.last_message_at)', 'DESC');

    this.aplicarFiltros(qb, filters);

    if (filters.reviewed === 'yes') {
      qb.having('COUNT(DISTINCT review.id) > 0');
    }
    if (filters.reviewed === 'no') {
      qb.having('COUNT(DISTINCT review.id) = 0');
    }

    // `getCount` no sirve con GROUP BY: cuenta filas del grupo, no grupos.
    const total = (await qb.getRawMany()).length;

    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        clientId: string;
        firstName: string;
        lastName: string | null;
        email: string | null;
        cellPhone: string | null;
        conversations: string;
        messages: string;
        lastMessageAt: Date;
        reviews: string;
      }>();

    const data = rows.map((row) => ({
      client: {
        id: row.clientId,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        cellPhone: row.cellPhone,
      },
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      reviews: Number(row.reviews),
      lastMessageAt: row.lastMessageAt,
    }));

    return { data, meta: { page, limit, total } };
  }

  /**
   * Los filtros, en un sitio: la caja única y los tres campos por separado.
   *
   * Quien busca por el nombre no siempre recuerda cómo lo escribió el
   * visitante, así que la caja única sirve para lo rápido y los campos para
   * cuando ya se sabe qué se busca.
   */
  private aplicarFiltros(
    qb: SelectQueryBuilder<ChatConversation>,
    filters: ConversationFilters,
  ): void {
    if (filters.clientId) {
      qb.andWhere('client.id = :clientId', { clientId: filters.clientId });
    }

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

    if (filters.name?.trim()) {
      qb.andWhere(
        "LOWER(client.first_name || ' ' || COALESCE(client.last_name, '')) LIKE :name",
        { name: `%${filters.name.trim().toLowerCase()}%` },
      );
    }
    if (filters.email?.trim()) {
      qb.andWhere('LOWER(client.email) LIKE :email', {
        email: `%${filters.email.trim().toLowerCase()}%`,
      });
    }
    if (filters.phone?.trim()) {
      const digits = filters.phone.replace(/\D/g, '');
      if (digits) {
        qb.andWhere('client.phone_normalized LIKE :tel', {
          tel: `%${digits.slice(-10)}%`,
        });
      }
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
  }

  /**
   * Todo lo que un cliente ha hablado, seguido.
   *
   * Se devuelven sus conversaciones en orden con sus mensajes dentro, para que
   * el panel las pinte como un solo hilo con una línea de separación entre
   * una y otra. Es como se lee una historia: de principio a fin, sabiendo
   * dónde hubo un corte.
   */
  async threadFor(clientId: string) {
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');

    const conversations = await this.conversations.find({
      where: { clientId },
      order: { createdAt: 'ASC' },
    });

    // Los mensajes de todas, en una consulta: una por conversación convierte
    // un cliente hablador en veinte viajes a la base.
    const ids = conversations.map((c) => c.id);
    const messages = ids.length
      ? await this.messages.find({
          where: { conversationId: In(ids) },
          order: { createdAt: 'ASC', position: 'ASC' },
        })
      : [];

    return {
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        cellPhone: client.cellPhone,
      },
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        propertyCode: conversation.propertyCode,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        messages: messages.filter((m) => m.conversationId === conversation.id),
      })),
    };
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
