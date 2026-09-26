import { PortalConfigError, PortalRejection } from './connector';

export interface PortalRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** Se serializa como JSON salvo que ya sea texto. */
  body?: unknown;
  /** Por defecto 30 s: un portal lento no puede dejar la cola colgada. */
  timeoutMs?: number;
}

/** Error transitorio: la cola lo reintenta con espera creciente. */
export class PortalTransientError extends Error {
  constructor(
    message: string,
    /** Si el portal dijo cuanto esperar (429), en ms. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PortalTransientError';
  }
}

/**
 * Una llamada a un portal, con los errores ya clasificados:
 *
 *  - 401 → `PortalConfigError`: credenciales. Reintentar no arregla nada.
 *  - 400/403/404/409/422 → `PortalRejection`: el portal no acepta lo enviado.
 *  - 429, 5xx, red, timeout → `PortalTransientError`: se reintenta.
 *
 * Devuelve el cuerpo ya parseado (JSON si lo es, texto si no).
 */
export async function portalFetch<T = unknown>(
  portal: string,
  url: string,
  req: PortalRequest = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...req.headers,
  };
  let body: string | undefined;
  if (req.body !== undefined) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    headers['Content-Type'] ??= 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const why =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'no respondio a tiempo'
        : 'no se pudo contactar';
    throw new PortalTransientError(`${portal} ${why}`);
  }

  const text = await res.text();
  let parsed: unknown = text;
  if (text && (res.headers.get('content-type') ?? '').includes('json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (res.ok) return parsed as T;

  const detail = describe(parsed) || res.statusText;
  const what = `${portal} respondio ${res.status}: ${detail}`;
  if (res.status === 401)
    throw new PortalConfigError(
      `${portal} rechazo las credenciales (${detail})`,
    );
  if (res.status === 429) {
    const seconds = Number(
      /(\d+)\s*seconds?/i.exec(detail)?.[1] ?? res.headers.get('retry-after'),
    );
    throw new PortalTransientError(
      what,
      Number.isFinite(seconds) ? (seconds + 1) * 1000 : undefined,
    );
  }
  if (res.status >= 500 || res.status === 408)
    throw new PortalTransientError(what);
  throw new PortalRejection(what);
}

/** Saca el mensaje util de las formas de error que usan los portales. */
function describe(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const nested =
    b.error && typeof b.error === 'object'
      ? (b.error as Record<string, unknown>)
      : null;
  const parts = [
    b.message,
    b.detail,
    b.error_description,
    typeof b.error === 'string' ? b.error : null,
    nested?.message,
    typeof nested?.tracking_id === 'string'
      ? `tracking ${nested.tracking_id}`
      : null,
    Array.isArray(b.errors) ? JSON.stringify(b.errors).slice(0, 300) : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts.length ? parts.join(' · ') : JSON.stringify(body).slice(0, 300);
}
