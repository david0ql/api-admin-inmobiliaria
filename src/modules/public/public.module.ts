import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CatalogModule } from '../catalog/catalog.module';
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
    ]),
    CatalogModule,
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
  ],
  providers: [
    PublicService,
    CaptchaService,
    ConsignmentsService,
    CreditRequestsService,
    SeoService,
  ],
  exports: [PublicService, ConsignmentsService, CreditRequestsService],
})
export class PublicModule {}
