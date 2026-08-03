import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CrmModule } from '../crm/crm.module';
import { IamModule } from '../iam/iam.module';
import { PropertiesModule } from '../properties/properties.module';
import { Appointment } from './domain/appointment.entity';
import { BookingSettings } from './domain/booking-settings.entity';
import { SchedulingService } from './scheduling.service';
import { AvailabilityService } from './availability.service';
import { BookingSettingsService } from './booking-settings.service';
import { SchedulingController } from './scheduling.controller';
import { BookingSettingsController } from './booking-settings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, BookingSettings]),
    IamModule,
    CrmModule,
    PropertiesModule,
    ActivityModule,
  ],
  controllers: [SchedulingController, BookingSettingsController],
  providers: [SchedulingService, AvailabilityService, BookingSettingsService],
  exports: [
    SchedulingService,
    AvailabilityService,
    BookingSettingsService,
    TypeOrmModule,
  ],
})
export class SchedulingModule {}
