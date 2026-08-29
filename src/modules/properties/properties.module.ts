import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { Property } from './domain/property.entity';
import { PropertyImage } from './domain/property-image.entity';
import { PropertyLabel } from './domain/property-label.entity';
import { PropertyAssignment } from './domain/property-assignment.entity';
import { PropertyFamily } from './domain/property-family.entity';
import { UnitType } from './domain/unit-type.entity';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { FamiliesService } from './families.service';
import { FamiliesController } from './families.controller';
import { UnitTypesService } from './unit-types.service';
import { UnitTypesController } from './unit-types.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Property,
      PropertyImage,
      PropertyLabel,
      PropertyAssignment,
      PropertyFamily,
      UnitType,
    ]),
    CatalogModule,
    IamModule,
    MediaModule,
  ],
  controllers: [PropertiesController, FamiliesController, UnitTypesController],
  providers: [PropertiesService, FamiliesService, UnitTypesService],
  exports: [
    PropertiesService,
    FamiliesService,
    UnitTypesService,
    TypeOrmModule,
  ],
})
export class PropertiesModule {}
