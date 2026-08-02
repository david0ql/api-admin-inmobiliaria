import 'reflect-metadata';
import { cpus } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import sharp from 'sharp';
import { AppDataSource } from '../shared/database/data-source';
import { validateEnv } from '../shared/config/env.schema';
import { PropertyImage } from '../modules/properties/domain/property-image.entity';

loadDotenv();
const env = validateEnv(process.env);
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = Math.max(2, cpus().length);

/** Debe coincidir con `MEDIUM_WIDTH` de StorageService. */
const MEDIUM_WIDTH = 1024;

sharp.concurrency(1);
sharp.cache({ files: 0 });

/**
 * Genera la variante intermedia de las fotos ya importadas.
 *
 * Se anadio despues de importar el inventario: sin ella, una tarjeta en movil
 * descargaba la version de 1600 px — 405 kB por foto — porque el thumb de
 * 560 px no cubre una pantalla de 412 px a densidad 1,75.
 *
 * No vuelve a descargar nada: parte del archivo de 2560 px que ya esta en
 * disco, asi que es solo un redimensionado por foto.
 */
async function main() {
  console.log(
    DRY_RUN ? 'Variante intermedia (SIMULACION)\n' : 'Variante intermedia\n',
  );
  await AppDataSource.initialize();

  try {
    const repo = AppDataSource.getRepository(PropertyImage);
    const root = env.UPLOADS_DIR.startsWith('/')
      ? env.UPLOADS_DIR
      : join(process.cwd(), env.UPLOADS_DIR);

    const images = await repo.find({
      select: { id: true, storageKey: true, url: true, urlMedium: true },
      loadEagerRelations: false,
    });
    console.log(`  ${images.length} imagenes en la base\n`);

    const pending = images.filter((image) => {
      const mediumKey = image.storageKey.replace(/-o\.webp$/, '-m.webp');
      return !image.urlMedium || !existsSync(join(root, mediumKey));
    });

    if (!pending.length) {
      console.log('  Nada que hacer: todas tienen su variante intermedia.');
      return;
    }
    console.log(`  ${pending.length} sin variante intermedia`);

    if (DRY_RUN) {
      console.log('\nSimulacion terminada: no se ha escrito nada.');
      return;
    }

    let done = 0;
    let failed = 0;
    let bytes = 0;
    const started = Date.now();
    let batch: { id: string; urlMedium: string }[] = [];

    const flush = async () => {
      if (!batch.length) return;
      const rows = batch;
      batch = [];
      await Promise.all(
        rows.map((row) =>
          repo.update({ id: row.id }, { urlMedium: row.urlMedium }),
        ),
      );
    };

    let cursor = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, pending.length) },
        async () => {
          while (cursor < pending.length) {
            const image = pending[cursor++];
            const archivePath = join(root, image.storageKey);
            const mediumKey = image.storageKey.replace(/-o\.webp$/, '-m.webp');

            try {
              if (!existsSync(archivePath))
                throw new Error('falta el archivo original');
              const out = await sharp(archivePath)
                .resize({ width: MEDIUM_WIDTH, withoutEnlargement: true })
                .webp({ quality: 80, effort: 3 })
                .toFile(join(root, mediumKey));

              bytes += out.size;
              batch.push({ id: image.id, urlMedium: `/media/${mediumKey}` });
              if (batch.length >= 100) await flush();
            } catch {
              failed++;
            }

            done++;
            if (done % 50 === 0 || done === pending.length) {
              const pct = Math.round((done / pending.length) * 100);
              process.stdout.write(
                `\r  generando: ${done}/${pending.length} (${pct}%)  ${(bytes / 1024 / 1024).toFixed(0)} MB   `,
              );
            }
          }
        },
      ),
    );

    await flush();
    process.stdout.write('\n');

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `\n  ${done - failed} generadas (${(bytes / 1024 / 1024).toFixed(0)} MB, ${seconds}s)` +
        (failed ? `, ${failed} fallidas` : ''),
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('\nFallo:', error instanceof Error ? error.message : error);
  process.exit(1);
});
