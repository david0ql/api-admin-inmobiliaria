import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CrmModule } from '../crm/crm.module';
import { IamModule } from '../iam/iam.module';
import { PropertiesModule } from '../properties/properties.module';
import { Appointment } from './domain/appointment.entity';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment]),
    IamModule,
    CrmModule,
    PropertiesModule,
    ActivityModule,
  ],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService, TypeOrmModule],
})
export class SchedulingModule {}
