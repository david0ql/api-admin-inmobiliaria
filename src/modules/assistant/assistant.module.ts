import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
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
  imports: [PublicModule, CatalogModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantTools, OpenAiProvider],
})
export class AssistantModule {}
