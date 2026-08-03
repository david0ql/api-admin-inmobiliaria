import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from '../../iam/domain/agent.entity';
import { ChatConversation } from './chat-conversation.entity';
import { ChatIssue } from './chat.enums';

/**
 * La calificación humana de una respuesta.
 *
 * El comentario es obligatorio a propósito. Marcar "tono robótico" y nada más
 * no sirve para corregir nada: lo que hace falta es qué habría estado bien, y
 * eso solo lo sabe quien lo leyó. Es también lo único que el modelo puede usar
 * para redactar una regla que valga.
 */
@Entity('chat_review')
export class ChatReview extends BaseEntity {
  @ApiProperty()
  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ChatConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ChatConversation;

  /** La respuesta concreta que se califica, si se señaló una. */
  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @ApiProperty({ enum: ChatIssue, isArray: true })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  issues: ChatIssue[];

  @ApiProperty()
  @Column({ type: 'text' })
  comment: string;

  /** La regla que redactó el modelo. Se guarda aunque no se aplique. */
  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  suggestedRule: string | null;

  /** La regla que se creó a partir de esto, si alguien la aprobó. */
  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  appliedRuleId: string | null;

  @ApiProperty()
  @Column({ type: 'uuid' })
  reviewedByAgentId: string;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by_agent_id' })
  reviewedBy: Agent | null;
}
