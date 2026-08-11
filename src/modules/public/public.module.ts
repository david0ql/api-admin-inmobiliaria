import { ExchangeRateService } from './exchange-rate.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CatalogModule } from '../catalog/catalog.module';
import { I18nModule } from '../i18n/i18n.module';
import { CrmModule } from '../crm/crm.module';
import { MediaModule } from '../media/media.module';
import { PropertiesModule } from '../properties/properties.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { Agent } from '../iam/domain/agent.entity';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { Property } from '../properties/domain/property.entity';
import { ConsignmentRequest } from './domain/consignment-request.entity';
import { CreditRequest } from './domain/credit-request.entity';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { CaptchaService } from './captcha.service';
import { ConsignmentsService } from './consignments.service';
import { ConsignmentsController } from './consignments.controller';
import { RenderService } from './render.service';
import { HomeSettings } from './domain/home-settings.entity';
import { HomeSettingsService } from './home-settings.service';
import { HomeSettingsController } from './home-settings.controller';
import { SeoService } from './seo.service';
import { SeoController } from './seo.controller';
import { CreditRequestsService } from './credit-requests.service';
import { CreditRequestsController } from './credit-requests.controller';

/**
 * Todo lo que consume la web de presentacion, mas la bandeja interna donde se
 * revisan las solicitudes que llegan de ella.
 */
@Module({
  imports: [
    // `Agent` solo para la tarjeta de contacto de la ficha publica: nombre,
    // telefono, correo y foto. Ver `publicAgent` en PublicService.
    TypeOrmModule.forFeature([
      ConsignmentRequest,
      CreditRequest,
      LeadSource,
      Property,
      Agent,
      HomeSettings,
    ]),
    CatalogModule,
    I18nModule,
    PropertiesModule,
    CrmModule,
    SchedulingModule,
    ActivityModule,
    MediaModule,
  ],
  controllers: [
    PublicController,
    ConsignmentsController,
    CreditRequestsController,
    SeoController,
    HomeSettingsController,
  ],
  providers: [
    ExchangeRateService,
    PublicService,
    CaptchaService,
    ConsignmentsService,
    CreditRequestsService,
    SeoService,
    RenderService,
    HomeSettingsService,
  ],
  exports: [
    PublicService,
    ConsignmentsService,
    CreditRequestsService,
    // Lo usa el registro del portal: un alta abierta sin captcha se llena de
    // basura igual que cualquier otro formulario publico.
    CaptchaService,
  ],
})
export class PublicModule {}
