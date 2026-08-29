import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppCacheModule } from './shared/cache/cache.module';
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
import { I18nModule } from './modules/i18n/i18n.module';
import { BranchesModule } from './modules/branches/branches.module';
import { BranchScopeInterceptor } from './modules/iam/branch-scope.interceptor';
import { PortalModule } from './modules/portal/portal.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { AttendanceModule } from './modules/attendance/attendance.module';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    AppCacheModule,
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
    I18nModule,
    BranchesModule,
    PortalModule,
    AssistantModule,
    AttendanceModule,
  ],
  controllers: [HealthController],
  providers: [
    /*
      La sede de cada peticion se decide una vez, al entrar, y no en cada
      consulta: basta que una de las cuarenta se olvide para que se filtren
      datos de otra oficina.
    */
    { provide: APP_INTERCEPTOR, useClass: BranchScopeInterceptor },
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
