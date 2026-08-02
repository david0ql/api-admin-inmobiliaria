import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../crm/domain/client.entity';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { PropertyInterest } from '../crm/domain/property-interest.entity';
import { CrmModule } from '../crm/crm.module';
import { Agent } from '../iam/domain/agent.entity';
import { MediaModule } from '../media/media.module';
import { Property } from '../properties/domain/property.entity';
import { ConsignmentRequest } from '../public/domain/consignment-request.entity';
import { PublicModule } from '../public/public.module';
import { Appointment } from '../scheduling/domain/appointment.entity';
import { ActivityModule } from '../activity/activity.module';
import { ClientRefreshToken } from './domain/client-refresh-token.entity';
import { ClientJwtStrategy } from './client-jwt.strategy';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalAdminController } from './portal-admin.controller';

/**
 * El portal del propietario: una cuenta sobre la ficha de cliente que ya
 * existe, para consignar inmuebles y seguirles la pista.
 *
 * Modulo aparte de `iam` a proposito. `iam` es la plantilla —roles, cartera,
 * permisos— y esto es un tercero que solo puede ver lo suyo. Compartir modulo
 * habria significado compartir estrategia, guard y tabla de sesiones, que es
 * justo lo que no se quiere.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      ClientRefreshToken,
      LeadSource,
      PropertyInterest,
      Property,
      Appointment,
      Agent,
      ConsignmentRequest,
    ]),
    PassportModule,
    JwtModule.register({}),
    CrmModule,
    PublicModule,
    MediaModule,
    ActivityModule,
  ],
  controllers: [PortalAuthController, PortalController, PortalAdminController],
  providers: [ClientJwtStrategy, PortalAuthService, PortalService],
  exports: [PortalAuthService],
})
export class PortalModule {}
