import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { ChatConversation } from './chat-conversation.entity';

/**
 * Un turno del hilo.
 *
 * Solo `user` y `assistant`: lo que se guarda es la conversación tal y como la
 * vivió el visitante, no la mecánica interna. Las llamadas a herramientas y sus
 * resultados no entran — ocupan mucho, cambian con el código y quien revisa no
 * los está juzgando.
 */
@Entity('chat_message')
export class ChatMessage extends BaseEntity {
  @ApiProperty()
  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ChatConversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ChatConversation;

  @ApiProperty({ enum: ['user', 'assistant'] })
  @Column({ type: 'text' })
  role: 'user' | 'assistant';

  @ApiProperty()
  @Column({ type: 'text' })
  content: string;

  /** Orden dentro del hilo: `createdAt` empata cuando van en el mismo segundo. */
  @ApiProperty()
  @Column({ type: 'int' })
  position: number;
}
