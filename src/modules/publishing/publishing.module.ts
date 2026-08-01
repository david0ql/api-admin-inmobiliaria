import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { PropertiesModule } from '../properties/properties.module';
import { PropertyPublication } from './domain/property-publication.entity';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PropertyPublication]),
    CatalogModule,
    PropertiesModule,
  ],
  controllers: [PublishingController],
  providers: [PublishingService],
  exports: [PublishingService, TypeOrmModule],
})
export class PublishingModule {}
