import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtSignOptions } from '@nestjs/jwt';
import type { Env } from './env.schema';

type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

/**
 * `jsonwebtoken` tipa `expiresIn` con un literal (`'15m' | '7d' | ...`) que una
 * variable de entorno no puede satisfacer estaticamente. El formato ya se valida
 * en tiempo de arranque, asi que aqui basta con estrechar el tipo.
 */
const ttl = (value: string): ExpiresIn => value as ExpiresIn;

/**
 * Acceso tipado a la configuracion. Evita `configService.get<string>('...')`
 * disperso por el codigo y con ello los typos silenciosos.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv() {
    return this.get('NODE_ENV');
  }
  get isProduction() {
    return this.nodeEnv === 'production';
  }
  get port() {
    return this.get('PORT');
  }
  get apiPrefix() {
    return this.get('API_PREFIX');
  }
  get corsOrigins() {
    return this.get('CORS_ORIGINS');
  }
  /** `false`, un numero de saltos, o la lista de proxies de confianza. */
  get trustProxy() {
    return this.get('TRUST_PROXY');
  }

  get database() {
    return {
      host: this.get('DATABASE_HOST'),
      port: this.get('DATABASE_PORT'),
      username: this.get('DATABASE_USER'),
      password: this.get('DATABASE_PASSWORD'),
      database: this.get('DATABASE_NAME'),
      ssl: this.get('DATABASE_SSL'),
      logging: this.get('DATABASE_LOGGING'),
    };
  }

  get jwt() {
    return {
      accessSecret: this.get('JWT_ACCESS_SECRET'),
      accessTtl: ttl(this.get('JWT_ACCESS_TTL')),
      refreshSecret: this.get('JWT_REFRESH_SECRET'),
      refreshTtl: ttl(this.get('JWT_REFRESH_TTL')),
    };
  }

  get seedAdmin() {
    return {
      email: this.get('SEED_ADMIN_EMAIL'),
      password: this.get('SEED_ADMIN_PASSWORD'),
    };
  }

  /** Clave inicial de los asesores importados; obliga a cambiarla al entrar. */
  get defaultUserPassword() {
    return this.get('DEFAULT_USER_PASSWORD');
  }

  get wasiDumpDir() {
    return this.get('WASI_DUMP_DIR');
  }

  get captcha() {
    return {
      provider: this.get('CAPTCHA_PROVIDER'),
      secret: this.get('CAPTCHA_SECRET'),
    };
  }

  get publicSiteUrl() {
    return this.get('PUBLIC_SITE_URL');
  }

  get publicSiteDist() {
    return this.get('PUBLIC_SITE_DIST');
  }

  get publicBookingLeadHours() {
    return this.get('PUBLIC_BOOKING_LEAD_HOURS');
  }

  get antivirusEnabled() {
    return this.get('ANTIVIRUS_ENABLED');
  }

  get uploadsDir() {
    return this.get('UPLOADS_DIR');
  }

  get uploadMaxBytes() {
    return this.get('UPLOAD_MAX_MB') * 1024 * 1024;
  }

  /**
   * El asistente de la web. `enabled` es la conjuncion de la bandera y de que
   * haya clave: sin `OPENAI_API_KEY` no hay chat aunque `CHAT_ENABLED` sea
   * cierto, y asi el servicio no tiene que repetir la comprobacion.
   */
  get chat() {
    const apiKey = this.get('OPENAI_API_KEY');
    return {
      enabled: this.get('CHAT_ENABLED') && Boolean(apiKey),
      provider: this.get('CHAT_PROVIDER'),
      apiKey,
      model: this.get('CHAT_MODEL'),
      baseUrl: this.get('CHAT_BASE_URL'),
      maxMessages: this.get('CHAT_MAX_MESSAGES'),
      maxChars: this.get('CHAT_MAX_CHARS'),
      maxSteps: this.get('CHAT_MAX_STEPS'),
    };
  }
}
