import 'reflect-metadata';
import { cpus } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import sharp from 'sharp';
import type { Repository } from 'typeorm';
import { AppDataSource } from '../shared/database/data-source';
import { validateEnv } from '../shared/config/env.schema';
import { FileSecurityService } from '../modules/media/file-security.service';
import { StorageService } from '../modules/media/storage.service';
import {
  ImageDevelopService,
  REVELADO_VERSION,
} from '../modules/media/image-develop.service';
import type { ImageAsset } from '../modules/media/image-asset.entity';
import { PropertyImage } from '../modules/properties/domain/property-image.entity';
import { FamilyImage } from '../modules/properties/domain/family-image.entity';
import { UnitTypeImage } from '../modules/properties/domain/unit-type-image.entity';

loadDotenv();
const env = validateEnv(process.env);

const DRY_RUN = process.argv.includes('--dry-run');
/** Deja las fotos sin revelar: es el deshacer en masa. */
const REVERTIR = process.argv.includes('--revertir');
/** Rehace tambien las ya reveladas; hace falta al cambiar el criterio. */
const FORCE = process.argv.includes('--force');
const CONFIRMAR = process.argv.includes('--confirmar');
const LIMITE = Number(
  process.argv.find((a) => a.startsWith('--limite='))?.split('=')[1] ??
    Infinity,
);
/**
 * Cuantas fotos a la vez. Por defecto la mitad de los nucleos y no todos: esto
 * se lanza contra el mismo servidor que atiende la web, y una foto revelada
 * tres segundos mas tarde no la nota nadie, pero una ficha que tarda tres
 * segundos en cargar si.
 */
const CONCURRENCIA = Number(
  process.argv.find((a) => a.startsWith('--concurrencia='))?.split('=')[1] ??
    Math.max(1, Math.floor(cpus().length / 2)),
);
/** Pausa entre fotos, en ms, para bajar mas la presion si hace falta. */
const PAUSA = Number(
  process.argv.find((a) => a.startsWith('--pausa='))?.split('=')[1] ?? 0,
);

sharp.concurrency(1);
sharp.cache({ files: 0 });

/**
 * Revela las fotos que ya estaban.
 *
 * Las 6.306 imagenes de produccion se guardaron antes de que existiera el
 * revelado: son las mismas fotos que las nuevas, solo que planas. Esto las pone
 * al dia sin volver a pedir nada a nadie, porque el archivo de 2560 px que ya
 * hay en disco ES el negativo: se copia a `-r.webp` la primera vez que se toca
 * cada foto y desde ese momento esa foto es reversible como las nuevas.
 *
 * Tres cosas que no hace, y que son el motivo de que se pueda lanzar en
 * produccion sin avisar a nadie:
 *
 * - No rehace lo que no lo necesita: lo pendiente es lo que tiene
 *   `developed_at` a nulo, asi que se puede cortar y reanudar sin llevar la
 *   cuenta, y una foto subida hoy —que ya nace revelada— no se vuelve a tocar.
 * - No satura la maquina: la mitad de los nucleos por defecto, con `--pausa`
 *   para bajarlo mas.
 * - No deja una foto a medias: cada variante se escribe entera o no se escribe,
 *   y la fila se actualiza cuando los cuatro ficheros ya estan.
 */
async function main() {
  const destino = `${env.DATABASE_NAME} @ ${env.DATABASE_HOST}`;
  const raiz = env.UPLOADS_DIR.startsWith('/')
    ? env.UPLOADS_DIR
    : join(process.cwd(), env.UPLOADS_DIR);

  console.log(REVERTIR ? 'Quitar el revelado\n' : 'Revelado de lo antiguo\n');
  console.log(`  base:     ${destino}`);
  console.log(`  ficheros: ${raiz}`);
  console.log(`  criterio: version ${REVELADO_VERSION}\n`);

  /*
    Escribe en la base Y en los ficheros de las fotos de clientes reales, asi
    que no arranca por descuido. `--dry-run` cuenta sin tocar nada; para tocar
    hay que haber leido a que base y a que carpeta apunta y decirlo.
  */
  if (!DRY_RUN && !CONFIRMAR) {
    console.log(
      '  Reescribe las variantes de cada foto. Comprueba las dos lineas de\n' +
        '  arriba y vuelve a lanzarlo con --confirmar (o con --dry-run para\n' +
        '  ver solo cuantas hay pendientes).',
    );
    return;
  }

  await AppDataSource.initialize();
  try {
    const storageConfig = {
      uploadsDir: env.UPLOADS_DIR,
      uploadMaxBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
      antivirusEnabled: env.ANTIVIRUS_ENABLED,
    } as never;
    const develop = new ImageDevelopService();
    const storage = new StorageService(
      storageConfig,
      new FileSecurityService(storageConfig),
      develop,
    );

    let restante = LIMITE;
    const total = { hechas: 0, sinCambio: 0, fallidas: 0, bytes: 0 };
    const inicio = Date.now();

    for (const entidad of [PropertyImage, FamilyImage, UnitTypeImage]) {
      if (restante <= 0) break;
      const repo = AppDataSource.getRepository(entidad) as Repository<
        ImageAsset & { id: string }
      >;

      const todas = await repo.find({
        select: {
          id: true,
          storageKey: true,
          url: true,
          urlMedium: true,
          urlLarge: true,
          urlOriginal: true,
          developedAt: true,
          develop: true,
        },
        loadEagerRelations: false,
      });

      const pendientes = todas
        .filter((img) =>
          FORCE
            ? true
            : !img.developedAt ||
              // Reveladas con un criterio anterior: se rehacen, y solo esas.
              (img.develop?.version ?? 0) < REVELADO_VERSION,
        )
        .slice(0, restante);

      console.log(
        `  ${entidad.name}: ${pendientes.length} pendientes de ${todas.length}`,
      );
      restante -= pendientes.length;
      if (DRY_RUN || !pendientes.length) continue;

      let cursor = 0;
      let hechas = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCIA, pendientes.length) },
          async () => {
            while (cursor < pendientes.length) {
              const imagen = pendientes[cursor++];
              try {
                if (!existsSync(join(raiz, imagen.storageKey))) {
                  throw new Error('falta el archivo');
                }
                const { revelado, bytes } = await storage.rerevelar(
                  imagen.storageKey,
                  (analisis) => (REVERTIR ? null : develop.plan(analisis)),
                );

                await repo.update(
                  { id: imagen.id },
                  {
                    developedAt: new Date(),
                    develop: revelado,
                    bytes,
                    // Sin marca de version el navegador y el proxy siguen
                    // sirviendo la foto vieja durante un anio: `/media/` va
                    // con `immutable`.
                    url: StorageService.marcarVersion(imagen.url),
                    urlMedium: imagen.urlMedium
                      ? StorageService.marcarVersion(imagen.urlMedium)
                      : null,
                    urlLarge: StorageService.marcarVersion(imagen.urlLarge),
                    urlOriginal: StorageService.marcarVersion(
                      imagen.urlOriginal,
                    ),
                  },
                );

                total.bytes += bytes;
                if (revelado) total.hechas++;
                else total.sinCambio++;
              } catch {
                total.fallidas++;
              }

              hechas++;
              if (hechas % 25 === 0 || hechas === pendientes.length) {
                const pct = Math.round((hechas / pendientes.length) * 100);
                process.stdout.write(
                  `\r    ${hechas}/${pendientes.length} (${pct}%)   `,
                );
              }
              if (PAUSA) await esperar(PAUSA);
            }
          },
        ),
      );
      process.stdout.write('\n');
    }

    if (DRY_RUN) {
      console.log('\n  Simulacion: no se ha escrito nada.');
      return;
    }

    const segundos = Math.round((Date.now() - inicio) / 1000);
    console.log(
      `\n  ${total.hechas} reveladas, ${total.sinCambio} no necesitaban nada` +
        (total.fallidas ? `, ${total.fallidas} fallidas` : '') +
        ` (${(total.bytes / 1024 / 1024).toFixed(0)} MB en disco, ${segundos}s)`,
    );
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error('\nFallo:', error instanceof Error ? error.message : error);
  process.exit(1);
});
