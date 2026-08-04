import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
} from 'typeorm';
import { Property } from '../../modules/properties/domain/property.entity';
import { PropertyFamily } from '../../modules/properties/domain/property-family.entity';
import { PropertyImage } from '../../modules/properties/domain/property-image.entity';
import { CacheBuster } from './cache-buster.service';

/**
 * Vacía la caché pública en cuanto el inventario cambia.
 *
 * Un suscriptor y no una llamada en cada servicio: los inmuebles se tocan desde
 * media docena de sitios —el panel, el importador, aceptar una consignación, el
 * asistente al agendar— y la lista crecerá. Aquí se entera de todos, incluidos
 * los que todavía no existen.
 *
 * Solo escrituras. Leer no invalida nada, que es justo lo que se quiere: la
 * portada la piden cien visitantes y la base se consulta una vez.
 */
@Injectable()
@EventSubscriber()
export class PropertyCacheSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly buster: CacheBuster,
  ) {
    dataSource.subscribers.push(this);
  }

  afterInsert(): void {
    void this.buster.flush('alta en el inventario');
  }

  afterUpdate(): void {
    void this.buster.flush('cambio en el inventario');
  }

  afterRemove(): void {
    void this.buster.flush('baja en el inventario');
  }

  afterSoftRemove(): void {
    void this.buster.flush('baja en el inventario');
  }

  /**
   * Solo lo que se ve en la web pública.
   *
   * Sin esto saltaría con cada cita, cada mensaje del chat y cada cambio de
   * etapa de un cliente — y la caché no llegaría a servir para nada.
   */
  listenTo(): typeof Property | typeof PropertyImage | typeof PropertyFamily {
    return Property;
  }
}
