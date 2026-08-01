import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../../shared/config/app-config.service';

const run = promisify(execFile);

export type FileKind = 'image' | 'document';

export interface SniffResult {
  /** Formato real deducido de los bytes, no de lo que dijo el cliente. */
  format: string;
  mimeType: string;
  extension: string;
  kind: FileKind;
}

/**
 * Firmas de los formatos admitidos.
 *
 * Se comprueban los bytes porque la extension y el `Content-Type` los elige
 * quien sube: `factura.pdf` puede ser un script y `foto.jpg` un HTML con
 * JavaScript. Lo unico que no miente es el contenido.
 */
const SIGNATURES: {
  format: string;
  mimeType: string;
  extension: string;
  kind: FileKind;
  test: (buffer: Buffer) => boolean;
}[] = [
  {
    format: 'jpeg',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    kind: 'image',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    format: 'png',
    mimeType: 'image/png',
    extension: 'png',
    kind: 'image',
    test: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    format: 'webp',
    mimeType: 'image/webp',
    extension: 'webp',
    kind: 'image',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    format: 'avif',
    mimeType: 'image/avif',
    extension: 'avif',
    kind: 'image',
    test: (b) =>
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      /avif|avis/.test(b.subarray(8, 12).toString('ascii')),
  },
  {
    format: 'heic',
    mimeType: 'image/heic',
    extension: 'heic',
    kind: 'image',
    // Las fotos de iPhone llegan en HEIC; sharp las convierte sin problema.
    test: (b) =>
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      /heic|heix|mif1|msf1/.test(b.subarray(8, 12).toString('ascii')),
  },
  {
    format: 'gif',
    mimeType: 'image/gif',
    extension: 'gif',
    kind: 'image',
    test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8'),
  },
  {
    format: 'tiff',
    mimeType: 'image/tiff',
    extension: 'tif',
    kind: 'image',
    test: (b) =>
      (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00),
  },
  {
    format: 'pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    kind: 'document',
    test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

/**
 * Construcciones de PDF que solo aparecen cuando el fichero pretende hacer algo
 * al abrirse. Un certificado de tradicion o una escritura no las lleva nunca.
 */
const PDF_DANGEROUS = [
  { token: '/JavaScript', reason: 'contiene JavaScript incrustado' },
  { token: '/JS', reason: 'contiene JavaScript incrustado' },
  { token: '/Launch', reason: 'intenta ejecutar un programa al abrirse' },
  { token: '/OpenAction', reason: 'ejecuta una accion automatica al abrirse' },
  { token: '/AA', reason: 'ejecuta acciones automaticas' },
  { token: '/EmbeddedFile', reason: 'lleva otro fichero dentro' },
  { token: '/RichMedia', reason: 'incrusta contenido ejecutable' },
  { token: '/XFA', reason: 'usa formularios XFA, que ejecutan logica' },
];

/**
 * Cadenas que delatan un fichero de texto disfrazado de otra cosa: shells,
 * paginas con script, ejecutables. Se buscan en la cabecera porque un
 * poliglota valido tiene que llevarlas al principio para funcionar.
 */
const SHELL_MARKERS = [
  '#!/',
  '<?php',
  '<%',
  '<script',
  '<svg',
  '<!doctype html',
  '<html',
  'MZ',
  'ELF',
];

@Injectable()
export class FileSecurityService {
  private readonly logger = new Logger(FileSecurityService.name);
  private clamAvailable: boolean | null = null;

  constructor(private readonly config: AppConfigService) {}

  /**
   * Comprueba que el fichero es lo que dice ser y que no lleva nada dentro.
   *
   * El orden importa: primero se identifica por firma, luego se descarta lo que
   * no se admite, y solo despues se inspecciona el contenido. Asi nunca se
   * analiza en profundidad algo que ya se iba a rechazar.
   */
  async inspect(
    buffer: Buffer,
    originalName: string,
    allowed: FileKind[] = ['image', 'document'],
  ): Promise<SniffResult> {
    const safeName = sanitizeName(originalName);

    if (!buffer.length)
      throw new BadRequestException(`"${safeName}" esta vacio`);
    if (buffer.length < 12)
      throw new BadRequestException(`"${safeName}" no es un fichero valido`);

    const sniffed = SIGNATURES.find((signature) => signature.test(buffer));
    if (!sniffed) {
      throw new BadRequestException(
        `"${safeName}" no es un formato admitido. Acepta JPG, PNG, WebP, HEIC o PDF.`,
      );
    }
    if (!allowed.includes(sniffed.kind)) {
      throw new BadRequestException(
        sniffed.kind === 'document'
          ? `"${safeName}" es un documento y aqui solo se admiten imagenes`
          : `"${safeName}" es una imagen y aqui solo se admiten documentos`,
      );
    }

    // Un poliglota es un fichero valido en dos formatos a la vez: pasa la firma
    // de imagen y aun asi el navegador lo interpreta como HTML si se sirve mal.
    const head = buffer.subarray(0, 2048).toString('latin1').toLowerCase();
    for (const marker of SHELL_MARKERS) {
      if (head.includes(marker.toLowerCase())) {
        throw new BadRequestException(
          `"${safeName}" mezcla codigo ejecutable con datos de imagen y se ha rechazado`,
        );
      }
    }

    if (sniffed.format === 'pdf') this.inspectPdf(buffer, safeName);
    await this.scanForMalware(buffer, safeName);

    return sniffed;
  }

  /**
   * Rechaza los PDF que hacen algo al abrirse.
   *
   * No pretende ser un antivirus: elimina la clase entera de PDF activos, que
   * es como llegan practicamente todos los ataques por documento adjunto.
   */
  private inspectPdf(buffer: Buffer, safeName: string): void {
    const text = buffer.toString('latin1');
    for (const { token, reason } of PDF_DANGEROUS) {
      // Los tokens de PDF van seguidos de delimitador; sin esto `/AA` casaria
      // dentro de cualquier cadena en base64 del propio documento.
      const pattern = new RegExp(`${token.replace('/', '\\/')}[\\s/<\\[\\(]`);
      if (pattern.test(text)) {
        throw new BadRequestException(
          `"${safeName}" ${reason} y se ha rechazado`,
        );
      }
    }
  }

  /**
   * Pasa el fichero por ClamAV si esta instalado.
   *
   * Es la ultima capa, no la primera: cuando llega aqui el fichero ya se
   * identifico por firma y — si es imagen — se va a reencodear entero, que
   * destruye cualquier carga util. ClamAV cubre lo que quede.
   */
  private async scanForMalware(
    buffer: Buffer,
    safeName: string,
  ): Promise<void> {
    if (!this.config.antivirusEnabled) return;

    if (this.clamAvailable === null) {
      this.clamAvailable = await run('clamdscan', ['--version'])
        .then(() => true)
        .catch(() => false);
      if (!this.clamAvailable) {
        this.logger.warn(
          'ANTIVIRUS_ENABLED=true pero clamdscan no esta disponible: no se analizan los ficheros.',
        );
      }
    }
    if (!this.clamAvailable) return;

    const dir = await mkdtemp(join(tmpdir(), 'serrano-scan-'));
    const path = join(dir, 'upload.bin');
    try {
      await writeFile(path, buffer);
      await run('clamdscan', ['--no-summary', '--fdpass', path], {
        timeout: 20_000,
      });
    } catch (error) {
      const output = String((error as { stdout?: string }).stdout ?? '');
      // clamdscan sale con 1 cuando encuentra algo, con 2 si falla el motor.
      if ((error as { code?: number }).code === 1 || output.includes('FOUND')) {
        this.logger.warn(
          `Fichero infectado rechazado: ${safeName} — ${output.trim()}`,
        );
        throw new BadRequestException(
          `"${safeName}" no paso el analisis de seguridad`,
        );
      }
      this.logger.error(`El analisis antivirus fallo: ${String(error)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Huella del binario, para no reprocesar dos veces la misma foto. */
  checksum(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }
}

/**
 * Nombre seguro para mostrar y para registrar.
 *
 * Nunca se usa para escribir en disco — el nombre real es un uuid — pero
 * acaba en la base y en la interfaz, asi que no puede llevar rutas ni marcado.
 */
export function sanitizeName(name: string): string {
  return (
    (name || 'archivo')
      .replace(/[\\/]/g, '_')
      .replace(/\.{2,}/g, '.')
      // eslint-disable-next-line no-control-regex -- los de control son justo lo que hay que quitar
      .replace(/[ -<>:"|?*]/g, '')
      .trim()
      .slice(0, 180)
  );
}
