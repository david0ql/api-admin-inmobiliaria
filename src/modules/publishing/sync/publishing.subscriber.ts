import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Property } from '../../properties/domain/property.entity';
import { PortalSyncService } from './portal-sync.service';

/**
 * Engancha el inventario con la cola de portales.
 *
 * Un suscriptor, como la cache publica, y por lo mismo: los inmuebles nacen en
 * el formulario del panel, al aceptar una consignacion y los que vengan. Una
 * llamada en cada sitio es una que alguien se olvida.
 *
 * Todo corre con el `manager` del evento, dentro de la transaccion que escribe
 * el inmueble: si esa transaccion se deshace, la cola tambien.
 */
@Injectable()
@EventSubscriber()
export class PublishingSubscriber implements EntitySubscriberInterface<Property> {
  constructor(
    dataSource: DataSource,
    private readonly sync: PortalSyncService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo(): typeof Property {
    return Property;
  }

  async afterInsert(event: InsertEvent<Property>): Promise<void> {
    await this.sync.onPropertyCreated(event.manager, event.entity);
  }

  async afterUpdate(event: UpdateEvent<Property>): Promise<void> {
    const id =
      (event.entity as Property | undefined)?.id ?? event.databaseEntity?.id;
    if (id) await this.sync.onPropertyChanged(event.manager, id);
  }

  async afterSoftRemove(event: SoftRemoveEvent<Property>): Promise<void> {
    const id = event.entity?.id ?? event.databaseEntity?.id;
    if (id) await this.sync.onPropertyRemoved(event.manager, id);
  }
}
