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

  /**
   * Cuantos proxies hay delante, o cuales.
   *
   * Sin esto, `req.ip` es la direccion de quien abre el socket — el proxy — y
   * no la del visitante: el limite de peticiones pasa a ser un cubo compartido
   * por todo el mundo y las IP que se guardan no valen para nada.
   *
   * Y `true` NO es la respuesta: haria que Express se creyera el
   * `X-Forwarded-For` de cualquiera, y entonces saltarse el limite es rotar una
   * cabecera. Por eso se admite un numero de saltos (1 si hay un solo nginx
   * delante) o una lista de IPs/CIDR de confianza, y por defecto esta apagado.
   */
  TRUST_PROXY: z
    .string()
    .default('')
    // El rechazo va ANTES del transform: despues llegaria el valor ya
    // convertido y "true" habria pasado como una lista de un elemento.
    .refine((v) => v.trim().toLowerCase() !== 'true', {
      message:
        'TRUST_PROXY no admite "true": eso haria que Express se creyera el ' +
        'X-Forwarded-For de cualquiera. Usa el numero de saltos (1, 2...) o ' +
        'la lista de IPs/CIDR de confianza.',
    })
    .transform((v): boolean | number | string[] => {
      const value = v.trim();
      if (!value || value === 'false' || value === '0') return false;
      if (/^\d+$/.test(value)) return Number(value);
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }),

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

  // --- asistente conversacional de la web publica ------------------------
  //
  // El chat de la web contesta preguntas sobre el inventario. El modelo NO
  // conoce los datos: solo puede pedirlos a las herramientas que golpean esta
  // misma API, asi que ningun precio ni ninguna alcoba sale de su imaginacion.
  //
  // La clave vive SOLO aqui, en el servidor. El navegador nunca la ve: todas
  // las llamadas al proveedor salen de la API. Si no hay clave, el asistente se
  // apaga y el endpoint devuelve 503 — el resto del sitio sigue igual.

  /** Enciende o apaga el chat sin tocar nada mas. */
  CHAT_ENABLED: bool.default(true),

  /**
   * Proveedor del modelo. Hoy solo `openai`; la interfaz `ChatProvider` deja
   * enchufar otro sin tocar el servicio.
   */
  CHAT_PROVIDER: z.enum(['openai']).default('openai'),

  /** Clave del proveedor. Sin ella el asistente queda apagado. */
  OPENAI_API_KEY: z.string().optional(),

  /**
   * Modelo. `gpt-4.1-mini` es el punto dulce coste/latencia con buen uso de
   * herramientas; `gpt-5.4-mini` u otro se ponen aqui sin tocar codigo.
   */
  CHAT_MODEL: z.string().default('gpt-4.1-mini'),

  /** Base del API del proveedor. Se deja configurable para proxys o Azure. */
  CHAT_BASE_URL: z.string().default('https://api.openai.com/v1'),

  /**
   * Techo de mensajes del historial que el cliente puede enviar por turno. El
   * hilo es efimero —no se guarda nada— y esto acota lo que entra al modelo:
   * ni coste desbocado ni un cliente empujando megas de texto.
   */
  CHAT_MAX_MESSAGES: z.coerce.number().int().min(2).max(80).default(40),

  /** Longitud maxima de un mensaje del visitante, en caracteres. */
  CHAT_MAX_CHARS: z.coerce.number().int().min(200).max(20_000).default(4_000),

  /** Tope de vueltas del bucle de herramientas por turno: acota el gasto. */
  CHAT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(6),

  // --- analisis de imagenes de inmueble -----------------------------------
  //
  // Mira las fotos de un inmueble y dice que estancia es cada una, si estan
  // presentables, en que orden van y si hay algo que no deba salir a una web
  // publica. Usa la MISMA clave que el asistente: `OPENAI_API_KEY`.
  //
  // Esto lo dispara SOLO el personal de la plataforma, nunca un cliente ni un
  // visitante, y cada llamada se paga por imagen. Los limites de aqui son
  // limites de gasto, no de tecnica.

  /** Enciende o apaga el analisis sin tocar el asistente. */
  IMAGE_AI_ENABLED: bool.default(true),

  /**
   * Modelo del analisis. Aparte de `CHAT_MODEL` porque son dos trabajos
   * distintos: el chat necesita herramientas y latencia baja, y esto necesita
   * ver imagenes. Poder cambiar uno sin tocar el otro es lo que permite probar
   * un modelo mejor en las fotos sin arriesgar el chat de la web.
   */
  IMAGE_AI_MODEL: z.string().default('gpt-4.1-mini'),

  /**
   * Cuantas fotos entran en una llamada. Es el freno de gasto principal: pulsar
   * "analizar" en un inmueble de cuarenta fotos no puede lanzar cuarenta cobros
   * sin que nadie lo haya decidido.
   */
  IMAGE_AI_MAX_IMAGES: z.coerce.number().int().min(1).max(40).default(20),

  /**
   * Cuanto detalle se le pide al modelo por imagen. `low` cuesta una fraccion y
   * basta para distinguir una cocina de una alcoba, que es lo que se pregunta;
   * `high` solo hace falta para leer texto pequeno dentro de la foto.
   */
  IMAGE_AI_DETAIL: z.enum(['low', 'high', 'auto']).default('low'),

  /** Techo de la respuesta, por si el modelo se desmanda escribiendo. */
  IMAGE_AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(500)
    .max(16_000)
    .default(4_000),
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
