import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SharedModule } from './shared/shared.module';
import { AllExceptionsFilter } from './shared/http/all-exceptions.filter';
import { RequestContextMiddleware } from './shared/request-context/request-context.middleware';
import { HealthController } from './health.controller';
import { IamModule } from './modules/iam/iam.module';
import { JwtAuthGuard } from './modules/iam/guards/jwt-auth.guard';
import { RolesGuard } from './modules/iam/guards/roles.guard';
import { MustChangePasswordGuard } from './modules/iam/guards/must-change-password.guard';
import { CatalogModule } from './modules/catalog/catalog.module';
import { MediaModule } from './modules/media/media.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { ActivityModule } from './modules/activity/activity.module';
import { CrmModule } from './modules/crm/crm.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PublicModule } from './modules/public/public.module';
import { PortalModule } from './modules/portal/portal.module';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    IamModule,
    CatalogModule,
    MediaModule,
    PropertiesModule,
    PublishingModule,
    ActivityModule,
    CrmModule,
    SchedulingModule,
    AnalyticsModule,
    PublicModule,
    PortalModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // El orden importa: se limita el trafico, se autentica, se exige haber
    // cambiado la clave inicial y por ultimo se comprueba el rol.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
