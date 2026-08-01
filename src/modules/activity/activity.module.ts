import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity } from './domain/activity.entity';
import { ActivitiesService } from './activities.service';

@Module({
  imports: [TypeOrmModule.forFeature([Activity])],
  providers: [ActivitiesService],
  exports: [ActivitiesService, TypeOrmModule],
})
export class ActivityModule {}
