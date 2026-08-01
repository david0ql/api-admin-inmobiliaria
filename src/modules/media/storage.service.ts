import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import sharp from 'sharp';
import { AppConfigService } from '../../shared/config/app-config.service';

export interface StoredImage {
  /** Ruta relativa dentro de `uploads/`; es lo que se guarda en la base. */
  key: string;
  url: string;
  urlLarge: string;
  urlOriginal: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  /** Huella del original: permite no reprocesar una foto ya guardada. */
  checksum: string;
}

const ACCEPTED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

/** Anchos derivados: listado, ficha y archivo. */
const THUMB_WIDTH = 560;
const LARGE_WIDTH = 1600;
/**
 * El archivo se topa en 2560 px. Las camaras suben fotos de 4032 px que nadie
 * mira a ese tamano; reencodearlas enteras era el 70 % del coste de CPU de la
 * importacion y multiplicaba por tres el espacio en disco.
 */
const ARCHIVE_WIDTH = 2560;

/**
 * libvips paraleliza cada operacion entre todos los nucleos. Con varias fotos
 * en vuelo eso solo produce contencion: el paralelismo lo pone la cola de
 * descargas, asi que cada imagen se procesa en un hilo.
 */
sharp.concurrency(1);
sharp.cache({ files: 0 });

/**
 * Almacenamiento local de imagenes.
 *
 * Todo lo que se sube — o se importa desde WASI — se procesa aqui: se valida
 * que sea una imagen de verdad leyendo sus metadatos (no fiandose del
 * `Content-Type`, que lo pone quien sube), se recomprime a WebP en dos anchos
 * y se guarda bajo `uploads/`. Asi el inventario deja de depender del CDN de un
 * proveedor externo que puede cortar el acceso el dia que se cierre la cuenta.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  readonly root: string;

  constructor(private readonly config: AppConfigService) {
    const dir = config.uploadsDir;
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }

  /** Ruta publica desde la que Express sirve `uploads/`. */
  private publicUrl(key: string): string {
    return `/media/${key}`;
  }

  /**
   * Guarda una imagen y sus derivados.
   *
   * `scope` agrupa por entidad (`properties/<id>`), de modo que borrar un
   * inmueble es borrar una carpeta.
   */
  async saveImage(
    buffer: Buffer,
    scope: string,
    originalName?: string,
  ): Promise<StoredImage> {
    if (!buffer.length) throw new BadRequestException('El archivo esta vacio');

    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException(
        `"${originalName ?? 'archivo'}" no es una imagen que se pueda procesar`,
      );
    }

    // sharp reporta el JPEG como `jpeg`, pero se normaliza por si acaso.
    const format = String(meta.format ?? '');
    const mimeType = format
      ? `image/${format === 'jpg' ? 'jpeg' : format}`
      : '';
    if (!ACCEPTED.has(mimeType)) {
      throw new BadRequestException(
        `Formato no admitido${format ? ` (${format})` : ''}. Usa JPG, PNG, WebP o AVIF.`,
      );
    }

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const id = randomUUID();
    const dir = join(this.root, scope);
    await mkdir(dir, { recursive: true });

    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const thumbKey = `${scope}/${id}-t.webp`;
    const largeKey = `${scope}/${id}-l.webp`;
    const originalKey = `${scope}/${id}-o.webp`;

    // Cadena en cascada: se decodifica el original una vez y cada tamano se
    // deriva del inmediatamente mayor. Antes se decodificaba tres veces el
    // fichero completo, que con fotos de 11 megapixeles es lo que hacia lento
    // el proceso.
    const archive = await sharp(buffer)
      .rotate() // respeta la orientacion EXIF
      .resize({ width: ARCHIVE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 86, effort: 3 })
      .toBuffer();

    const large = await sharp(archive)
      .resize({ width: LARGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82, effort: 3 })
      .toBuffer();

    const thumb = await sharp(large)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 })
      .toBuffer();

    await Promise.all([
      writeFile(join(this.root, thumbKey), thumb),
      writeFile(join(this.root, largeKey), large),
      writeFile(join(this.root, originalKey), archive),
    ]);

    return {
      key: originalKey,
      url: this.publicUrl(thumbKey),
      urlLarge: this.publicUrl(largeKey),
      urlOriginal: this.publicUrl(originalKey),
      width,
      height,
      bytes: thumb.length + large.length + archive.length,
      mimeType: 'image/webp',
      checksum,
    };
  }

  /**
   * Descarga una imagen remota y la guarda. Devuelve null si la descarga falla:
   * en una importacion de 6.340 fotos, una URL caida no puede abortar el lote.
   */
  async saveFromUrl(
    url: string,
    scope: string,
    { timeoutMs = 20_000, maxBytes = 25 * 1024 * 1024 } = {},
  ): Promise<StoredImage | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} al descargar ${url}`);
        return null;
      }

      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        this.logger.warn(
          `Imagen descartada por tamano (${declared} bytes): ${url}`,
        );
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) {
        this.logger.warn(
          `Imagen descartada por tamano (${buffer.length} bytes): ${url}`,
        );
        return null;
      }

      return await this.saveImage(buffer, scope, url);
    } catch (error) {
      this.logger.warn(
        `No se pudo descargar ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Borra las tres variantes a partir de la clave del original. */
  async remove(key: string): Promise<void> {
    if (!key) return;
    const base = key.replace(/-o\.webp$/, '');
    await Promise.all(
      ['-t.webp', '-l.webp', '-o.webp'].map((suffix) =>
        rm(join(this.root, `${base}${suffix}`), { force: true }),
      ),
    );
  }

  /** Borra la carpeta completa de una entidad. */
  async removeScope(scope: string): Promise<void> {
    await rm(join(this.root, scope), { recursive: true, force: true });
  }

  /** Estado del almacenamiento, para diagnostico. */
  usage(): { root: string; exists: boolean } {
    return { root: this.root, exists: existsSync(this.root) };
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await stat(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  /** Ruta absoluta en disco; solo la usa el servido estatico. */
  absolute(key: string): string {
    const full = resolve(this.root, key);
    // Defensa contra `../`: nunca se sale de `uploads/`.
    if (!full.startsWith(this.root)) {
      throw new BadRequestException('Ruta de archivo invalida');
    }
    return full;
  }

  static directoryOf(key: string): string {
    return dirname(key);
  }
}
