import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Lector del volcado de WASI (`data/wasi/`).
 *
 * Su API devuelve las colecciones como un objeto con claves numericas ("0",
 * "1", …) junto a metadatos como `total` y `status`. Aqui se normaliza todo a
 * arrays y objetos limpios para que el resto del importador no tenga que
 * conocer esa peculiaridad.
 */
export class WasiDump {
  readonly root: string;

  constructor(dir: string) {
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    if (!existsSync(this.root)) {
      throw new Error(
        `No encuentro el volcado de WASI en ${this.root}. Ajusta WASI_DUMP_DIR en el .env`,
      );
    }
  }

  /** Contenido crudo del fichero, sin normalizar. */
  read<T>(name: string): T | null {
    const file = join(this.root, `${name}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  }

  /** Fichero cuyo contenido ya es un array. */
  array<T = Record<string, unknown>>(name: string): T[] {
    const data = this.read<unknown>(name);
    if (!data) return [];
    return toArray<T>(data);
  }

  /** Fichero indexado por id (`{ "3893890": {...} }`). */
  byId<T = unknown>(name: string): Map<number, T> {
    const data = this.read<Record<string, T>>(name);
    const out = new Map<number, T>();
    if (!data) return out;
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && /^\d+$/.test(key)) out.set(Number(key), value);
    }
    return out;
  }

  /** Fichero indexado por id cuyo valor es a su vez una coleccion. */
  collectionsById<T = Record<string, unknown>>(name: string): Map<number, T[]> {
    const raw = this.byId<unknown>(name);
    const out = new Map<number, T[]>();
    for (const [id, value] of raw) out.set(id, toArray<T>(value));
    return out;
  }

  has(name: string): boolean {
    return existsSync(join(this.root, `${name}.json`));
  }
}

/** Convierte la respuesta de WASI en un array, descartando `total`/`status`. */
export function toArray<T>(data: unknown): T[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data !== 'object') return [];
  return Object.entries(data as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        /^\d+$/.test(key) && value !== null && typeof value === 'object',
    )
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value as T);
}

// --- normalizadores -------------------------------------------------------

/**
 * Convierte a texto un valor de origen desconocido. Los objetos se serializan
 * como JSON en lugar de degradar a "[object Object]", que enmascararia datos
 * mal formados del volcado en vez de dejarlos a la vista.
 */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return value.toString();
  return JSON.stringify(value) ?? '';
}

/** WASI serializa los booleanos como las cadenas "true"/"false". */
export function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Numero o null. Trata "", "0.00" y basura como ausencia de dato. */
export function num(value: unknown, { zeroIsNull = true } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(stringify(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (zeroIsNull && parsed === 0) return null;
  return parsed;
}

export function int(
  value: unknown,
  opts?: { zeroIsNull?: boolean },
): number | null {
  const parsed = num(value, opts);
  return parsed === null ? null : Math.trunc(parsed);
}

/** Texto recortado, o null si esta vacio. */
export function str(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) return null;
  const text = stringify(value).trim();
  if (!text || text === 'null' || text === 'NULL') return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

/** Fecha de WASI. `0000-00-00` es su forma de decir "vacio". */
export function date(value: unknown): Date | null {
  const text = str(value);
  if (!text || text.startsWith('0000-00-00')) return null;
  const parsed = new Date(
    text.includes('T') ? text : text.replace(' ', 'T') + 'Z',
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Fecha en formato `YYYY-MM-DD` para columnas `date`. */
export function dateOnly(value: unknown): string | null {
  const parsed = date(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

/** Ano de construccion: WASI lo guarda como "2012" o como fecha completa. */
export function year(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  const match = text.match(/\d{4}/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return parsed >= 1800 && parsed <= 2100 ? parsed : null;
}

/**
 * Convierte a texto plano las observaciones, que llegan como HTML con
 * entidades escapadas (`&nbsp;`, `&oacute;`).
 */
export function html(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  return (
    text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&aacute;/g, 'á')
      .replace(/&eacute;/g, 'é')
      .replace(/&iacute;/g, 'í')
      .replace(/&oacute;/g, 'ó')
      .replace(/&uacute;/g, 'ú')
      .replace(/&ntilde;/g, 'ñ')
      .replace(/&Aacute;/g, 'Á')
      .replace(/&Eacute;/g, 'É')
      .replace(/&Iacute;/g, 'Í')
      .replace(/&Oacute;/g, 'Ó')
      .replace(/&Uacute;/g, 'Ú')
      .replace(/&Ntilde;/g, 'Ñ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null
  );
}

/**
 * Correo utilizable. Proppit rellena los huecos con direcciones sinteticas del
 * tipo `only-phone_+573108813255@proppit.com`, que no son de nadie: se
 * descartan para no ensuciar la base ni mandarles correo.
 */
export function email(value: unknown): string | null {
  const text = str(value)?.toLowerCase();
  if (!text || !text.includes('@')) return null;
  if (text.startsWith('only-phone')) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text.slice(0, 180);
}

/** Telefono en formato canonico de 10 digitos (movil colombiano). */
export function phoneKey(value: unknown): string | null {
  const digits = str(value)?.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  const local =
    digits.startsWith('57') && digits.length > 10 ? digits.slice(2) : digits;
  return local.slice(-10);
}
