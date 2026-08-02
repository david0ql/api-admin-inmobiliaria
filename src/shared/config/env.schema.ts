import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Formato que entiende `ms`: 30s, 15m, 24h, 7d… */
const DURATION = /^\d+\s*(ms|s|m|h|d|w|y)$/i;
const DURATION_MSG = 'Debe ser una duracion valida, por ejemplo 15m, 24h o 7d';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_SSL: bool.default(false),
  DATABASE_LOGGING: bool.default(false),

  JWT_ACCESS_SECRET: z
    .string()
    .min(16, 'JWT_ACCESS_SECRET debe tener al menos 16 caracteres'),
  JWT_ACCESS_TTL: z.string().regex(DURATION, DURATION_MSG).default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_TTL: z.string().regex(DURATION, DURATION_MSG).default('7d'),

  SEED_ADMIN_EMAIL: z.email().default('admin@serrano-inmobiliaria.com'),
  // Sin valor por defecto a proposito: un default en el codigo acaba siendo la
  // contrasena real de todos los despliegues, y ademas queda publicada en el
  // repositorio.
  SEED_ADMIN_PASSWORD: z.string().min(8),

  /**
   * Clave con la que nacen los asesores importados. Entran con ella una sola
   * vez: el guard `MustChangePasswordGuard` les cierra el resto de la API
   * hasta que la cambian.
   */
  DEFAULT_USER_PASSWORD: z.string().min(8),

  WASI_DUMP_DIR: z.string().default('../data/wasi'),

  /** Captcha de los formularios publicos: turnstile o recaptcha. */
  CAPTCHA_PROVIDER: z.enum(['turnstile', 'recaptcha']).default('turnstile'),
  /** Sin secreto la verificacion se salta y se avisa por log. */
  CAPTCHA_SECRET: z.string().optional(),

  /** Dominio publico: lo usan el sitemap y las URL canonicas. */
  PUBLIC_SITE_URL: z
    .string()
    .default('https://web-clientes-inmobiliaria.nordikhat.com'),

  /**
   * Donde deja el build del sitio publico su `index.html`. Es lo que se sirve,
   * con la cabecera del inmueble inyectada, a las URL de ficha.
   */
  PUBLIC_SITE_DIST: z
    .string()
    .default('/var/www/web-clientes-inmobiliaria.nordikhat.com/dist'),

  /** Antelacion minima para pedir una visita desde la web, en horas. */
  PUBLIC_BOOKING_LEAD_HOURS: z.coerce
    .number()
    .int()
    .min(0)
    .max(720)
    .default(24),

  /**
   * Analisis antivirus de los ficheros subidos. Requiere `clamdscan` en el
   * sistema; si no esta, la API lo avisa por log y sigue con el resto de capas.
   */
  ANTIVIRUS_ENABLED: bool.default(false),

  /** Carpeta donde viven las imagenes subidas e importadas. */
  UPLOADS_DIR: z.string().default('./uploads'),
  /** Tamano maximo por archivo en la subida, en megabytes. */
  UPLOAD_MAX_MB: z.coerce.number().int().positive().max(100).default(15),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno al arrancar. Si falta o esta mal una variable el proceso
 * no llega a levantar: mejor fallar aqui que a mitad de una peticion.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuracion de entorno invalida:\n${detail}`);
  }
  return parsed.data;
}
