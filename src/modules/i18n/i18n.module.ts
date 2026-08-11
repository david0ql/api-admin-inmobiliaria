import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Translation } from './domain/translation.entity';
import { I18nService } from './i18n.service';
import { I18nController } from './i18n.controller';

/**
 * Los textos de la web, editables desde el panel.
 *
 * Vive aparte de `public` porque no es contenido del negocio —no son inmuebles
 * ni clientes— sino la piel del sitio, y porque el panel necesita escribir en
 * el mismo sitio del que lee la web.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Translation])],
  controllers: [I18nController],
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
