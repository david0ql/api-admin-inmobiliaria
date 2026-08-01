import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { City, Country, Region, Zone } from './domain/geography.entity';
import {
  ClientType,
  Currency,
  Feature,
  Portal,
  PropertyType,
} from './domain/catalogs.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

const ENTITIES = [
  Country,
  Region,
  City,
  Zone,
  PropertyType,
  Feature,
  Currency,
  ClientType,
  Portal,
];

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService, TypeOrmModule],
})
export class CatalogModule {}
