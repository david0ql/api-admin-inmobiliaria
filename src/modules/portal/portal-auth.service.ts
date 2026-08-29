import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Client } from '../crm/domain/client.entity';
import { defaultBranchId } from '../branches/default-branch';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { PipelinesService } from '../crm/pipelines.service';
import { normalizePhone } from '../crm/clients.service';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { ClientRefreshToken } from './domain/client-refresh-token.entity';
import {
  CLIENT_TOKEN_TYPE,
  PORTAL_AUDIENCE,
  PORTAL_ISSUER,
  derivePortalSecret,
  type ClientTokenPayload,
} from './client-jwt.strategy';
import type { LoginPortalDto, RegisterPortalDto } from './dto/portal.dto';

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface PortalSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: string | number;
  client: {
    id: string;
    email: string;
    fullName: string;
    mustChangePassword: boolean;
  };
}

/** Tras cinco fallos la cuenta descansa quince minutos. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/**
 * Argon2id con parametros explicitos. Los de por defecto de la libreria cambian
 * entre versiones; fijarlos evita que una actualizacion baje el coste sin que
 * nadie se entere.
 */
const ARGON: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(ClientRefreshToken)
    private readonly tokens: Repository<ClientRefreshToken>,
    @InjectRepository(LeadSource)
    private readonly sources: Repository<LeadSource>,
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private get accessSecret() {
    return derivePortalSecret(this.config.jwt.accessSecret, 'access');
  }

  private get refreshSecret() {
    return derivePortalSecret(this.config.jwt.refreshSecret, 'refresh');
  }

  // --- registro ----------------------------------------------------------

  /**
   * Alta desde la web publica.
   *
   * Devuelve siempre lo mismo, exista o no ya ese correo. Dos motivos, y los
   * dos importan:
   *
   * 1. Si contestara distinto, el formulario seria un oraculo para preguntar
   *    "¿es X cliente de esta agencia?" una direccion cada vez.
   * 2. Si un correo ya existe en la cartera, NO se le cuelgan credenciales.
   *    Nadie verifica aqui que quien escribe ese correo sea su dueno, asi que
   *    hacerlo entregaria la ficha de un propietario real —sus inmuebles, sus
   *    visitas, su asesor— a quien acertase la direccion. Ese caso lo resuelve
   *    un asesor desde el panel, que si puede comprobar con quien habla.
   */
  async register(dto: RegisterPortalDto, meta: SessionMeta): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const phoneNormalized = normalizePhone(dto.cellPhone);

    // El correo manda, pero el movil tambien identifica: la agencia tiene 554
    // moviles repetidos y colgarle una cuenta al duplicado equivocado es el
    // mismo problema con otra puerta.
    const existing = await this.clients
      .createQueryBuilder('client')
      .where('LOWER(client.email) = :email', { email })
      .orWhere(
        phoneNormalized ? 'client.phone_normalized = :phone' : 'FALSE',
        phoneNormalized ? { phone: phoneNormalized } : {},
      )
      .getOne();

    if (existing) {
      /*
        Un aviso en el log no lo lee nadie, y del otro lado hay una persona
        esperando: acaba de rellenar el formulario, ha leido que ya puede
        entrar, y al intentarlo se va a encontrar un 401 sin explicacion.

        Asi que se le deja el caso al asesor en la ficha del cliente, que es
        donde mira. Lo que se le contesta al visitante no cambia —sigue siendo
        la misma frase exista o no el correo, o el formulario seria un oraculo
        para preguntar "¿es X cliente de esta agencia?"— pero ahora hay alguien
        que puede llamarle.

        Vale tambien para el caso incomodo: el movil coincide pero la persona
        es otra. Con 554 moviles repetidos en la cartera eso pasa, y solo se
        resuelve hablando.
      */
      const porTelefono =
        existing.email?.toLowerCase() !== email && phoneNormalized
          ? ` El correo no coincide: entro por el movil ${dto.cellPhone.trim()}, que puede ser de otra persona.`
          : '';

      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: existing.id,
        summary: 'Intento de crear cuenta en el portal',
        detail:
          `${dto.firstName.trim()} ${dto.lastName.trim()} intento registrarse con ${email} ` +
          `y el movil ${dto.cellPhone.trim()}, y ya existe esta ficha.${porTelefono}` +
          ' No se le dio acceso: hay que comprobar con quien se habla y darselo desde el panel.',
        automatic: true,
      });

      this.logger.warn(
        `Alta en el portal rechazada: ${email} ya existe en la cartera (cliente ${existing.id}). ` +
          `IP ${meta.ipAddress ?? 'desconocida'}.`,
      );
      return;
    }

    const pipeline = await this.pipelines.findDefault();
    const stage = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    const source = await this.sources.findOne({
      where: { name: 'Página web' },
    });

    await this.clients.save(
      this.clients.create({
        // Quien se registra desde fuera cae en la sede principal; de ahi lo
        // reparte quien atienda su solicitud.
        branchId: await defaultBranchId(this.clients.manager),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        cellPhone: dto.cellPhone.trim(),
        phoneNormalized,
        identification: dto.identification?.trim() ?? null,
        cityId: dto.cityId ?? null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        stageChangedAt: new Date(),
        sourceId: source?.id ?? null,
        // Sin asesor: lo reparte quien corresponda cuando llegue su solicitud.
        assignedAgentId: null,
        acceptsMarketing: dto.acceptsMarketing ?? false,
        requirement: 'Se registró en el portal para consignar un inmueble',
        lastContactedAt: null,
        passwordHash: await argon2.hash(dto.password, ARGON),
        portalEnabled: true,
        // La eligio el, no se la dicto nadie: no hay nada que cambiar.
        mustChangePassword: false,
        selfRegistered: true,
      }),
    );
  }

  // --- sesion ------------------------------------------------------------

  async login(dto: LoginPortalDto, meta: SessionMeta): Promise<PortalSession> {
    const email = dto.email.trim().toLowerCase();

    const client = await this.clients
      .createQueryBuilder('client')
      .addSelect([
        'client.passwordHash',
        'client.failedLoginAttempts',
        'client.lockedUntil',
      ])
      .where('LOWER(client.email) = :email', { email })
      .andWhere('client.portalEnabled = TRUE')
      .getOne();

    /*
     * Se verifica un hash siempre, exista la cuenta o no: si no, el tiempo de
     * respuesta diria que correos estan dados de alta aunque el mensaje sea el
     * mismo.
     */
    const hash = client?.passwordHash ?? (await decoyHash());
    const ok = await argon2.verify(hash, dto.password).catch(() => false);

    if (!client || !client.passwordHash) throw invalid();

    if (client.lockedUntil && client.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Demasiados intentos fallidos. Prueba de nuevo en unos minutos.',
      );
    }

    if (!ok) {
      await this.registerFailure(client);
      throw invalid();
    }

    await this.clients.update(
      { id: client.id },
      {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastPortalLoginAt: new Date(),
      },
    );

    return this.issue(client, meta);
  }

  private async registerFailure(client: Client): Promise<void> {
    const attempts = (client.failedLoginAttempts ?? 0) + 1;
    const locked =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : null;

    await this.clients.update(
      { id: client.id },
      {
        failedLoginAttempts: locked ? 0 : attempts,
        lockedUntil: locked,
      },
    );

    if (locked) {
      this.logger.warn(
        `Portal: cuenta ${client.id} bloqueada ${LOCK_MINUTES} min tras ${MAX_FAILED_ATTEMPTS} fallos`,
      );
    }
  }

  /**
   * Rotacion con deteccion de reutilizacion: presentar un token ya canjeado
   * significa que hay dos partes con el mismo secreto, y una de ellas no
   * deberia. Se tumban todas las sesiones de esa cuenta.
   */
  async refresh(rawToken: string, meta: SessionMeta): Promise<PortalSession> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.refreshSecret,
        audience: PORTAL_AUDIENCE,
        issuer: PORTAL_ISSUER,
      });
    } catch {
      throw new UnauthorizedException('Sesion caducada');
    }

    const stored = await this.tokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!stored) throw new UnauthorizedException('Sesion desconocida');

    if (!stored.isUsable) {
      this.logger.warn(
        `Portal: reutilizacion de refresh del cliente ${stored.clientId}, revoco todo`,
      );
      await this.revokeAll(stored.clientId);
      throw new UnauthorizedException(
        'Sesion revocada por seguridad, vuelve a entrar',
      );
    }

    const client = await this.clients.findOne({
      where: { id: payload.sub },
      loadEagerRelations: false,
    });
    if (!client || !client.portalEnabled) {
      throw new UnauthorizedException('Cuenta inexistente o sin acceso');
    }

    stored.revokedAt = new Date();
    await this.tokens.save(stored);
    return this.issue(client, meta);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.tokens.update(
      { tokenHash: hashToken(rawToken) },
      { revokedAt: new Date() },
    );
  }

  async revokeAll(clientId: string): Promise<void> {
    await this.tokens.update(
      { clientId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async changePassword(
    clientId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const client = await this.clients
      .createQueryBuilder('client')
      .addSelect('client.passwordHash')
      .where('client.id = :clientId', { clientId })
      .getOne();

    const ok =
      client?.passwordHash &&
      (await argon2.verify(client.passwordHash, current).catch(() => false));
    if (!ok)
      throw new UnauthorizedException('La contraseña actual no coincide');

    await this.clients.update(
      { id: clientId },
      {
        passwordHash: await argon2.hash(next, ARGON),
        mustChangePassword: false,
      },
    );
    // Cambiar la clave cierra el resto de sesiones: si alguien mas la tenia,
    // deja de tenerla ahora y no cuando caduque su token.
    await this.revokeAll(clientId);
  }

  /** La usa el panel cuando un asesor le fija la clave a un cliente. */
  async setPasswordFromStaff(
    clientId: string,
    password: string,
  ): Promise<void> {
    await this.clients.update(
      { id: clientId },
      {
        passwordHash: await argon2.hash(password, ARGON),
        portalEnabled: true,
        // Se la dicto alguien: solo vale para entrar y cambiarla.
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    );
    await this.revokeAll(clientId);
  }

  async setPortalEnabled(clientId: string, enabled: boolean): Promise<void> {
    await this.clients.update({ id: clientId }, { portalEnabled: enabled });
    if (!enabled) await this.revokeAll(clientId);
  }

  async purgeExpiredTokens(): Promise<number> {
    const { affected } = await this.tokens.delete({
      expiresAt: LessThan(new Date()),
    });
    return affected ?? 0;
  }

  private async issue(
    client: Client,
    meta: SessionMeta,
  ): Promise<PortalSession> {
    const payload: ClientTokenPayload = {
      sub: client.id,
      typ: CLIENT_TOKEN_TYPE,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.config.jwt.accessTtl,
      audience: PORTAL_AUDIENCE,
      issuer: PORTAL_ISSUER,
    });

    const jti = randomBytes(24).toString('hex');
    const refreshToken = await this.jwt.signAsync(
      { sub: client.id, typ: CLIENT_TOKEN_TYPE, jti },
      {
        secret: this.refreshSecret,
        expiresIn: this.config.jwt.refreshTtl,
        audience: PORTAL_AUDIENCE,
        issuer: PORTAL_ISSUER,
      },
    );

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.tokens.save(
      this.tokens.create({
        clientId: client.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(exp * 1000),
        revokedAt: null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.jwt.accessTtl,
      client: {
        id: client.id,
        email: client.email ?? '',
        fullName: client.fullName,
        mustChangePassword: client.mustChangePassword,
      },
    };
  }
}

/** Mismo mensaje para correo inexistente y clave equivocada. */
function invalid() {
  return new UnauthorizedException('Correo o contraseña incorrectos');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Un hash real contra el que verificar cuando la cuenta no existe. Se calcula
 * una vez y se reutiliza: lo que interesa igualar es el coste de `verify`, no
 * el de generarlo.
 */
let decoy: string | null = null;
async function decoyHash(): Promise<string> {
  decoy ??= await argon2.hash(randomBytes(32).toString('hex'), ARGON);
  return decoy;
}

/** Comparacion de cadenas sin filtrar por tiempo. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
