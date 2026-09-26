import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { MediaModule } from '../media/media.module';
import { PropertiesModule } from '../properties/properties.module';
import { Property } from '../properties/domain/property.entity';
import { PortalConnection } from './domain/portal-connection.entity';
import { PortalLocation } from './domain/portal-location.entity';
import { PropertyPublication } from './domain/property-publication.entity';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { PortalSyncController } from './portal-sync.controller';
import { PortalPublicController } from './portal-public.controller';
import { PortalImagesController } from './portal-images.controller';
import {
  PORTAL_CONNECTORS,
  ConnectorRegistry,
} from './sync/connector-registry';
import { PortalSyncService } from './sync/portal-sync.service';
import { ConnectionsService } from './sync/connections.service';
import { LocationsService } from './sync/locations.service';
import { PublishingSubscriber } from './sync/publishing.subscriber';
import { FeedConnector } from './connectors/feed.connector';
import { FincaraizConnector } from './connectors/fincaraiz.connector';
import { MetrocuadradoConnector } from './connectors/metrocuadrado.connector';
import { ProppitConnector } from './connectors/proppit.connector';
import { MetaConnector } from './connectors/meta.connector';

/** Un conector por integracion. Anadir uno es anadirlo aqui y a `ConnectorKey`. */
const CONNECTORS = [
  FeedConnector,
  FincaraizConnector,
  MetrocuadradoConnector,
  ProppitConnector,
  MetaConnector,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PropertyPublication,
      PortalConnection,
      PortalLocation,
      Property,
    ]),
    CatalogModule,
    PropertiesModule,
    MediaModule,
  ],
  controllers: [
    PublishingController,
    PortalSyncController,
    PortalPublicController,
    PortalImagesController,
  ],
  providers: [
    PublishingService,
    ...CONNECTORS,
    {
      provide: PORTAL_CONNECTORS,
      useFactory: (...connectors: unknown[]) => connectors,
      inject: CONNECTORS,
    },
    ConnectorRegistry,
    PortalSyncService,
    ConnectionsService,
    LocationsService,
    PublishingSubscriber,
  ],
  exports: [PublishingService, PortalSyncService, TypeOrmModule],
})
export class PublishingModule {}
