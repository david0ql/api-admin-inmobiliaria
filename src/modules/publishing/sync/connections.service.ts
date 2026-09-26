import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { PortalConnection } from '../domain/portal-connection.entity';
import type { UpdateConnectionDto } from '../publishing.dto';
import { ConnectorRegistry } from './connector-registry';
import { PortalSyncService } from './portal-sync.service';
import { decryptSecrets, encryptSecrets } from './secrets';

/**
 * Alta y prueba de las conexiones con los portales. Solo ADMIN.
 *
 * Nunca devuelve un secreto: el panel recibe, por cada campo, si esta relleno.
 * Para cambiar una clave se escribe entera; un campo que llega vacio no borra
 * lo guardado, porque el formulario no puede ensenar lo que habia.
 */
@Injectable()
export class ConnectionsService {
  constructor(
    @InjectRepository(PortalConnection)
    private readonly conns: Repository<PortalConnection>,
    private readonly registry: ConnectorRegistry,
    private readonly sync: PortalSyncService,
    private readonly config: AppConfigService,
  ) {}

  async list() {
    const conns = await this.conns
      .createQueryBuilder('c')
      .addSelect('c.credentialsEnc')
      .leftJoinAndSelect('c.portal', 'portal')
      .orderBy('portal.name', 'ASC')
      .getMany();
    return conns.map((c) => this.present(c));
  }

  async update(portalId: number, dto: UpdateConnectionDto) {
    const conn = await this.load(portalId);
    const connector = this.registry.get(conn.connector);
    if (!connector)
      throw new BadRequestException('Este portal no tiene integracion todavia');

    if (dto.credentials && Object.values(dto.credentials).some(Boolean)) {
      const key = this.secretKey();
      // Si la clave del servidor cambio, lo viejo es ilegible: se empieza de cero.
      const current = conn.credentialsEnc
        ? safeDecrypt(key, conn.credentialsEnc)
        : {};
      const allowed = new Set(connector.credentialFields.map((f) => f.key));
      for (const [k, v] of Object.entries(dto.credentials)) {
        if (!allowed.has(k))
          throw new BadRequestException(`Campo desconocido: ${k}`);
        if (typeof v !== 'string')
          throw new BadRequestException(`${k} debe ser texto`);
        if (v) current[k] = v.trim();
      }
      conn.credentialsEnc = encryptSecrets(key, current);
    }

    if (dto.settings) {
      const allowed = new Set(connector.settingFields.map((f) => f.key));
      const next = { ...conn.settings };
      for (const [k, v] of Object.entries(dto.settings)) {
        if (!allowed.has(k))
          throw new BadRequestException(`Ajuste desconocido: ${k}`);
        if (typeof v !== 'string')
          throw new BadRequestException(`${k} debe ser texto`);
        if (v) next[k] = v.trim();
        else delete next[k];
      }
      conn.settings = next;
    }

    if (dto.sandbox !== undefined) conn.sandbox = dto.sandbox;
    if (dto.autoPublishNew !== undefined)
      conn.autoPublishNew = dto.autoPublishNew;

    if (dto.enabled !== undefined) {
      if (dto.enabled) {
        const missing = this.missingFields(conn);
        if (missing.length) {
          throw new BadRequestException(
            `Faltan datos para conectar: ${missing.join(', ')}`,
          );
        }
      }
      conn.enabled = dto.enabled;
    }

    await this.conns.save(conn);
    if (conn.enabled) await this.sync.wakePortal(portalId);
    return this.present(conn);
  }

  /** Prueba las credenciales contra el portal y deja el resultado a la vista. */
  async test(portalId: number) {
    const conn = await this.load(portalId);
    const connector = this.registry.get(conn.connector);
    if (!connector)
      throw new BadRequestException('Este portal no tiene integracion todavia');

    const missing = this.missingFields(conn);
    let ok = false;
    let message: string;
    if (missing.length) {
      message = `Faltan datos: ${missing.join(', ')}`;
    } else {
      try {
        message = await connector.test(await this.sync.context(conn));
        ok = true;
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
    }
    conn.lastCheckAt = new Date();
    conn.lastCheckOk = ok;
    conn.lastCheckMessage = message.slice(0, 1000);
    await this.conns.save(conn);
    return this.present(conn);
  }

  // --- piezas --------------------------------------------------------------

  private present(conn: PortalConnection) {
    const connector = this.registry.get(conn.connector);
    let stored: Record<string, string> = {};
    const key = this.config.portals.secretKey;
    if (conn.credentialsEnc && key) {
      try {
        stored = decryptSecrets(key, conn.credentialsEnc);
      } catch {
        stored = {};
      }
    }
    const base = this.sync.apiBase();
    return {
      portalId: conn.portalId,
      portal: conn.portal,
      connector: conn.connector,
      mode: connector?.mode ?? null,
      instructions: connector?.instructions ?? null,
      enabled: conn.enabled,
      autoPublishNew: conn.autoPublishNew,
      sandbox: conn.sandbox,
      credentials: (connector?.credentialFields ?? []).map((f) => ({
        ...f,
        filled: Boolean(stored[f.key]),
      })),
      settings: (connector?.settingFields ?? []).map((f) => ({
        ...f,
        value: conn.settings[f.key] ?? '',
      })),
      feedUrl:
        connector?.mode === 'feed'
          ? `${base}/public/feeds/${conn.portalId}/${conn.inboundToken}.xml`
          : null,
      callbackUrl: connector?.handleCallback
        ? `${base}/public/portal-callbacks/${conn.portalId}/${conn.inboundToken}`
        : null,
      secretKeyConfigured: Boolean(key),
      lastCheckAt: conn.lastCheckAt,
      lastCheckOk: conn.lastCheckOk,
      lastCheckMessage: conn.lastCheckMessage,
    };
  }

  private missingFields(conn: PortalConnection): string[] {
    const connector = this.registry.get(conn.connector);
    if (!connector) return [];
    const key = this.config.portals.secretKey;
    const stored =
      conn.credentialsEnc && key ? safeDecrypt(key, conn.credentialsEnc) : {};
    return [
      ...connector.credentialFields.filter((f) => f.required && !stored[f.key]),
      ...connector.settingFields.filter(
        (f) => f.required && !conn.settings[f.key],
      ),
    ].map((f) => f.label);
  }

  private secretKey(): Buffer {
    const key = this.config.portals.secretKey;
    if (!key) {
      throw new ServiceUnavailableException(
        'Falta PORTALS_SECRET_KEY en el servidor: sin ella no se pueden guardar credenciales.',
      );
    }
    return key;
  }

  private async load(portalId: number): Promise<PortalConnection> {
    const conn = await this.conns
      .createQueryBuilder('c')
      .addSelect('c.credentialsEnc')
      .leftJoinAndSelect('c.portal', 'portal')
      .where('c.portal_id = :portalId', { portalId })
      .getOne();
    if (!conn) throw new NotFoundException('Ese portal no tiene conexion');
    return conn;
  }
}

function safeDecrypt(key: Buffer, payload: string): Record<string, string> {
  try {
    return decryptSecrets(key, payload);
  } catch {
    return {};
  }
}
