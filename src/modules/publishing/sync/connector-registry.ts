import { Inject, Injectable } from '@nestjs/common';
import type { ConnectorKey } from '../domain/portal-connection.entity';
import type { PortalConnector } from './connector';

export const PORTAL_CONNECTORS = Symbol('PORTAL_CONNECTORS');

/** Encuentra el conector de una conexion por su clave. */
@Injectable()
export class ConnectorRegistry {
  private readonly byKey: Map<ConnectorKey, PortalConnector>;

  constructor(@Inject(PORTAL_CONNECTORS) connectors: PortalConnector[]) {
    this.byKey = new Map(connectors.map((c) => [c.key, c]));
  }

  get(key: ConnectorKey): PortalConnector | null {
    return this.byKey.get(key) ?? null;
  }
}
