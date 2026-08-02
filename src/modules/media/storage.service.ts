import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { AppConfigService } from '../../shared/config/app-config.service';
import { FileSecurityService, sanitizeName } from './file-security.service';

export interface StoredImage {
  /** Ruta relativa dentro de `uploads/`; es lo que se guarda en la base. */
  key: string;
  url: string;
  urlMedium: string;
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

/**
 * Tope de pixeles de entrada. Una foto de 100 megapixeles no existe en este
 * negocio, pero un PNG manipulado que los declare tumba el proceso al
 * decodificarlo.
 */
const MAX_INPUT_PIXELS = 100_000_000;

/** Anchos derivados: listado, tarjeta en movil, ficha y archivo. */
const THUMB_WIDTH = 560;
/**
 * El tamano intermedio existe por los moviles. Una foto a pantalla completa
 * ocupa 412 px logicos, pero a densidad 1,75 el navegador necesita 721 px
 * reales; sin este paso saltaba a la de 1600 px, o sea 405 kB por foto en
 * lugar de 43.
 *
 * 800 y no 1024: 1024 son un 40% de pixeles de mas sobre los 721 que hacen
 * falta, y esta es la foto que el navegador cronometra para decidir si la ficha
 * va rapida. Bajarla a 800 son ~60 kB menos en la unica imagen que el visitante
 * esta esperando ver, y a 1,94 veces la densidad de la pantalla no se aprecia.
 */
const MEDIUM_WIDTH = 800;
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

  /** Lo que se sirve en `/media/`: imagenes, que son el anuncio. */
  readonly root: string;

  /**
   * Lo que NO se sirve: escrituras, cedulas, certificados de tradicion.
   *
   * Carpeta HERMANA de `root` y no una subcarpeta suya. `useStaticAssets`
   * publica el arbol entero de `root`, asi que cualquier cosa colgada de el es
   * descargable por quien acierte la ruta — y un uuid en la URL es ocultar, no
   * proteger: esas direcciones acaban en el historial, en los logs del proxy y
   * en la cabecera `Referer`. Estando fuera, no hay `express.static` que las
   * alcance aunque alguien se equivoque en el orden de los middlewares.
   */
  readonly privateRoot: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly security: FileSecurityService,
  ) {
    const dir = config.uploadsDir;
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    this.privateRoot = resolve(
      this.root,
      '..',
      `${basename(this.root)}-private`,
    );
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
    const safeName = sanitizeName(originalName ?? 'imagen');

    // Primero se comprueba que es una imagen de verdad y que no lleva nada
    // dentro; solo despues se decodifica. Al reencodearla entera desaparece
    // cualquier carga util que hubiera sobrevivido: lo que se guarda son
    // pixeles nuevos, no los bytes que subio el usuario.
    await this.security.inspect(buffer, safeName, ['image']);

    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer, {
        // Corta las bombas de descompresion: un PNG de 2 KB puede declarar
        // 50.000 x 50.000 px y agotar la memoria del proceso al decodificarlo.
        limitInputPixels: MAX_INPUT_PIXELS,
        // Un solo fotograma: los GIF animados no son fotos de inmueble.
        pages: 1,
      }).metadata();
    } catch {
      throw new BadRequestException(
        `"${safeName}" no es una imagen que se pueda procesar`,
      );
    }

    // sharp reporta el JPEG como `jpeg`, pero se normaliza por si acaso.
    const format = String(meta.format ?? '');
    const mimeType = format
      ? `image/${format === 'jpg' ? 'jpeg' : format}`
      : '';
    if (!ACCEPTED.has(mimeType)) {
      throw new BadRequestException(
        `Formato no admitido${format ? ` (${format})` : ''}. Usa JPG, PNG, WebP, HEIC o AVIF.`,
      );
    }

    const checksum = this.security.checksum(buffer);
    const id = randomUUID();
    const dir = join(this.root, scope);
    await mkdir(dir, { recursive: true });

    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const thumbKey = `${scope}/${id}-t.webp`;
    const mediumKey = `${scope}/${id}-m.webp`;
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

    const medium = await sharp(large)
      .resize({ width: MEDIUM_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80, effort: 3 })
      .toBuffer();

    const thumb = await sharp(medium)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 })
      .toBuffer();

    await Promise.all([
      writeFile(join(this.root, thumbKey), thumb),
      writeFile(join(this.root, mediumKey), medium),
      writeFile(join(this.root, largeKey), large),
      writeFile(join(this.root, originalKey), archive),
    ]);

    return {
      key: originalKey,
      url: this.publicUrl(thumbKey),
      urlMedium: this.publicUrl(mediumKey),
      urlLarge: this.publicUrl(largeKey),
      urlOriginal: this.publicUrl(originalKey),
      width,
      height,
      bytes: thumb.length + medium.length + large.length + archive.length,
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

  /**
   * Guarda un documento tal cual, sin procesarlo y FUERA de lo que se sirve.
   *
   * Sin reencodear porque una escritura es un PDF que hay que conservar byte a
   * byte. Y fuera de `/media/` porque su contenido es la cedula y las
   * escrituras de una persona: se piden por un endpoint que comprueba quien
   * pregunta, no por una URL que vale para cualquiera que la tenga.
   *
   * No devuelve `url`: no hay ninguna publica, y devolver uno invitaria a
   * pintarlo en un `<a href>` que no llevaria credencial.
   */
  async savePrivate(
    buffer: Buffer,
    scope: string,
    originalName: string,
    { maxBytes = 10 * 1024 * 1024 } = {},
  ): Promise<{
    key: string;
    bytes: number;
    originalName: string;
  }> {
    const safeName = sanitizeName(originalName);
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `"${safeName}" pesa mas de ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }

    // Un documento no se reencodea, asi que la inspeccion es lo unico que hay
    // entre el fichero del usuario y el disco: aqui se apura mas — firma real,
    // rechazo de poliglotas y de PDF con acciones automaticas.
    const sniffed = await this.security.inspect(buffer, safeName, [
      'document',
      'image',
    ]);

    // El nombre en disco es un uuid y la extension sale de la firma, no del
    // nombre que envio el usuario: no hay travesia de rutas ni doble extension.
    const key = `${scope}/${randomUUID()}.${sniffed.extension}`;
    await mkdir(join(this.privateRoot, scope), { recursive: true });
    // 0600: el proceso lee y escribe; nadie mas en la maquina.
    await writeFile(join(this.privateRoot, key), buffer, { mode: 0o600 });

    return { key, bytes: buffer.length, originalName: safeName };
  }

  /**
   * Ruta en disco de un documento privado.
   *
   * La clave sale de la base, no de la URL, pero se comprueba igualmente que
   * el resultado caiga dentro de `privateRoot`: el dia que alguien exponga un
   * endpoint que acepte la clave desde fuera, `../../etc/passwd` ya esta
   * cerrado.
   */
  privatePath(key: string): string {
    const path = resolve(this.privateRoot, key);
    if (path !== this.privateRoot && !path.startsWith(this.privateRoot + sep)) {
      throw new BadRequestException('Ruta de documento invalida');
    }
    return path;
  }

  /** Borra las tres variantes a partir de la clave del original. */
  async remove(key: string): Promise<void> {
    if (!key) return;
    const base = key.replace(/-o\.webp$/, '');
    await Promise.all(
      ['-t.webp', '-m.webp', '-l.webp', '-o.webp'].map((suffix) =>
        rm(join(this.root, `${base}${suffix}`), { force: true }),
      ),
    );
  }

  /** Borra la carpeta completa de una entidad, en los dos almacenes. */
  async removeScope(scope: string): Promise<void> {
    await rm(join(this.root, scope), { recursive: true, force: true });
    await rm(join(this.privateRoot, scope), { recursive: true, force: true });
  }

  /** Estado del almacenamiento, para diagnostico. */
  usage(): { root: string; exists: boolean } {
    return { root: this.root, exists: existsSync(this.root) };
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    // 0700: la carpeta de documentos no la lista nadie mas.
    await mkdir(this.privateRoot, { recursive: true, mode: 0o700 });
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
