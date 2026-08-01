import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { Property } from './domain/property.entity';
import { PropertyImage } from './domain/property-image.entity';
import { PropertyLabel } from './domain/property-label.entity';
import { PropertyAssignment } from './domain/property-assignment.entity';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Property,
      PropertyImage,
      PropertyLabel,
      PropertyAssignment,
    ]),
    CatalogModule,
    IamModule,
    MediaModule,
  ],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService, TypeOrmModule],
})
export class PropertiesModule {}
