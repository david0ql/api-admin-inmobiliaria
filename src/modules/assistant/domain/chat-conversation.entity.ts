import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Client } from '../../crm/domain/client.entity';
import { ChatMessage } from './chat-message.entity';

/**
 * Una conversación del chat público, guardada.
 *
 * Se guarda para poder revisarla: sin el hilo delante no se puede decir qué
 * falló en una respuesta, y sin eso no hay forma de corregir al asistente más
 * que a ojo.
 *
 * Siempre tiene cliente. El chat pide nombre y contacto antes de la primera
 * pregunta, así que no hay conversaciones huérfanas: cada una es un lead con
 * su ficha en la cartera.
 */
@Entity('chat_conversation')
export class ChatConversation extends BaseEntity {
  @ApiProperty()
  @Index()
  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  /** `GLOBAL` o el código del inmueble desde cuya ficha se abrió. */
  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  propertyCode: string | null;

  @ApiProperty()
  @Index()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastMessageAt: Date;

  /** Se guarda contado para poder ordenar y filtrar sin recorrer los mensajes. */
  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @Column({ type: 'text', nullable: true })
  ipAddress: string | null;

  @OneToMany(() => ChatMessage, (message) => message.conversation)
  messages: ChatMessage[];
}
