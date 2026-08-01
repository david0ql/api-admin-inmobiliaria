import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IamModule } from '../iam/iam.module';
import { PropertiesModule } from '../properties/properties.module';
import { Client } from './domain/client.entity';
import { LeadSource } from './domain/lead-source.entity';
import { Pipeline, PipelineStage } from './domain/pipeline.entity';
import { PropertyInterest } from './domain/property-interest.entity';
import { ClientsService } from './clients.service';
import { PipelinesService } from './pipelines.service';
import { CrmController } from './crm.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      Pipeline,
      PipelineStage,
      LeadSource,
      PropertyInterest,
    ]),
    CatalogModule,
    IamModule,
    PropertiesModule,
    ActivityModule,
  ],
  controllers: [CrmController],
  providers: [ClientsService, PipelinesService],
  exports: [ClientsService, PipelinesService, TypeOrmModule],
})
export class CrmModule {}
