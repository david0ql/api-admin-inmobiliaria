import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { Agent } from '../domain/agent.entity';
import { RefreshToken } from '../domain/refresh-token.entity';
import { AgentStatus } from '../domain/role.enum';
import { AgentsService } from '../agents/agents.service';
import { assertCanEditAgent } from '../scope';
import type { AuthenticatedActor } from '../../../shared/request-context/request-context';
import type { SessionResponse } from './auth.dto';
import type { AccessTokenPayload } from './jwt.strategy';

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
  ) {}

  async login(
    email: string,
    password: string,
    meta: SessionMeta,
  ): Promise<SessionResponse> {
    const agent = await this.agents.findByEmailWithSecret(email);

    // Se verifica siempre un hash aunque el correo no exista, para que el tiempo
    // de respuesta no revele que cuentas estan dadas de alta.
    const hash = agent?.passwordHash ?? (await decoyHash());
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!agent || !ok || !agent.passwordHash) {
      throw new UnauthorizedException('Credenciales invalidas');
    }
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    await this.agents.touchLogin(agent.id);
    return this.issueSession(agent, meta);
  }

  /**
   * Rotacion de refresh: se revoca el token presentado y se emite uno nuevo.
   * Si llega un token ya revocado se invalidan todas las sesiones del asesor,
   * porque significa que alguien esta reutilizando credenciales robadas.
   */
  async refresh(rawToken: string, meta: SessionMeta): Promise<SessionResponse> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido o caducado');
    }

    const stored = await this.tokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!stored) throw new UnauthorizedException('Refresh token desconocido');

    if (!stored.isUsable) {
      this.logger.warn(
        `Reutilizacion de refresh token del asesor ${stored.agentId}: revoco todo`,
      );
      await this.revokeAllForAgent(stored.agentId);
      throw new UnauthorizedException(
        'Sesion revocada por seguridad, vuelve a iniciar sesion',
      );
    }

    const agent = await this.agents.findByIdOrNull(payload.sub);
    if (!agent || agent.status !== AgentStatus.ACTIVE) {
      throw new UnauthorizedException('Cuenta inexistente o desactivada');
    }

    stored.revokedAt = new Date();
    await this.tokens.save(stored);
    return this.issueSession(agent, meta);
  }

  async logout(rawToken: string): Promise<void> {
    await this.tokens.update(
      { tokenHash: hashToken(rawToken) },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForAgent(agentId: string): Promise<void> {
    // `IsNull()` y no `undefined`: TypeORM rechaza los undefined en un where.
    await this.tokens.update(
      { agentId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async changePassword(
    agentId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const agent = await this.agents.findById(agentId);
    const withSecret = await this.agents.findByEmailWithSecret(agent.email);
    const ok =
      withSecret?.passwordHash &&
      (await argon2
        .verify(withSecret.passwordHash, current)
        .catch(() => false));
    if (!ok)
      throw new UnauthorizedException('La contrasena actual no coincide');

    await this.agents.setPassword(agentId, next);
    // Cambiar la contrasena cierra el resto de sesiones.
    await this.revokeAllForAgent(agentId);
  }

  /**
   * Restablecimiento por otra persona: la administracion —o quien manda en la
   * sede— le pone una contrasena a alguien que no puede entrar.
   *
   * Deliberadamente separado de `changePassword` y no un parametro suyo. Son
   * dos operaciones con dos verdades distintas: alli quien cambia la clave la
   * sabe y hay que exigirsela; aqui no la sabe —ni tiene por que— y lo que
   * hace falta comprobar es el mando. Juntarlas en una funcion con un `if`
   * seria dejar a un `if` mal puesto la distancia entre "cambio mi clave" y
   * "le cambio la clave a otro".
   */
  async resetPasswordFor(
    actor: AuthenticatedActor,
    targetId: string,
    password: string,
  ): Promise<void> {
    const target = await this.agents.findById(targetId);

    /*
     * Sobre uno mismo, jamas. Esta ruta no pide la contrasena actual, asi que
     * si valiera para la propia cuenta seria el camino corto para saltarse esa
     * comprobacion: bastaria un portatil abierto un minuto para quedarse con
     * la cuenta de un administrador sin saber su clave.
     */
    if (actor.id === target.id) {
      throw new ForbiddenException(
        'Para cambiar tu propia contrasena usa /auth/change-password, que pide la actual',
      );
    }
    assertCanEditAgent(actor, target);

    await this.agents.setPassword(target.id, password, true);
    await this.revokeAllForAgent(target.id);
  }

  /** Limpia tokens caducados; se puede colgar de un cron mas adelante. */
  async purgeExpiredTokens(): Promise<number> {
    const { affected } = await this.tokens.delete({
      expiresAt: LessThan(new Date()),
    });
    return affected ?? 0;
  }

  private async issueSession(
    agent: Agent,
    meta: SessionMeta,
  ): Promise<SessionResponse> {
    const payload: AccessTokenPayload = {
      sub: agent.id,
      email: agent.email,
      role: agent.role,
      name: agent.fullName,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.jwt.accessSecret,
      expiresIn: this.config.jwt.accessTtl,
    });

    const jti = randomBytes(24).toString('hex');
    const refreshToken = await this.jwt.signAsync(
      { sub: agent.id, jti },
      {
        secret: this.config.jwt.refreshSecret,
        expiresIn: this.config.jwt.refreshTtl,
      },
    );

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.tokens.save(
      this.tokens.create({
        agentId: agent.id,
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
      user: {
        id: agent.id,
        email: agent.email,
        fullName: agent.fullName,
        role: agent.role,
        photoUrl: agent.photoUrl,
        mustSetPassword: agent.mustSetPassword,
      },
    };
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Hash señuelo sobre una cadena aleatoria. Se calcula una sola vez y se
 * reutiliza para que verificar un correo inexistente cueste lo mismo que uno
 * real: sin esto, la diferencia de tiempos permite enumerar cuentas.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  return decoy;
}
