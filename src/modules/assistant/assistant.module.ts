import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { CrmModule } from '../crm/crm.module';
import { Client } from '../crm/domain/client.entity';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { ChatConversation } from './domain/chat-conversation.entity';
import { ChatMessage } from './domain/chat-message.entity';
import { ChatReview } from './domain/chat-review.entity';
import { AssistantRule } from './domain/assistant-rule.entity';
import { AssistantSettings } from './domain/assistant-settings.entity';
import { AssistantAdminController } from './assistant-admin.controller';
import { ConversationsService } from './conversations.service';
import { ReviewsService } from './reviews.service';
import { RulesService } from './rules.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PublicModule } from '../public/public.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant.tools';
import { OpenAiProvider } from './openai-provider';

/**
 * El asistente conversacional de la web publica.
 *
 * No tiene entidades propias: es efimero por diseño (no guarda hilos) y se apoya
 * en `PublicModule` —lo mismo que sirve la web— para leer el inventario y
 * agendar, y en `CatalogModule` para resolver nombres de ciudad, zona y tipo a
 * sus ids. La clave del modelo vive solo en el servidor; nada de esto se expone
 * al navegador salvo por el endpoint de chat, que va con limite de trafico.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      ChatReview,
      AssistantRule,
      AssistantSettings,
      Client,
      LeadSource,
    ]),
    PublicModule,
    CatalogModule,
    SchedulingModule,
    CrmModule,
  ],
  controllers: [AssistantController, AssistantAdminController],
  providers: [
    AssistantService,
    AssistantTools,
    OpenAiProvider,
    ConversationsService,
    ReviewsService,
    RulesService,
  ],
})
export class AssistantModule {}
