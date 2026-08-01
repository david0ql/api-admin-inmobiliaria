import 'reflect-metadata';
import { cpus } from 'node:os';
import * as argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../shared/database/data-source';
import { validateEnv } from '../shared/config/env.schema';
import { StorageService } from '../modules/media/storage.service';
import { Agent } from '../modules/iam/domain/agent.entity';
import { AgentStatus, Role } from '../modules/iam/domain/role.enum';
import { City, Zone } from '../modules/catalog/domain/geography.entity';
import {
  ClientType,
  Feature,
  Portal,
  PropertyType,
} from '../modules/catalog/domain/catalogs.entity';
import { Property } from '../modules/properties/domain/property.entity';
import { PropertyImage } from '../modules/properties/domain/property-image.entity';
import { PropertyLabel } from '../modules/properties/domain/property-label.entity';
import {
  AssignmentRole,
  PropertyAssignment,
} from '../modules/properties/domain/property-assignment.entity';
import {
  WASI_AVAILABILITY,
  WASI_CONDITION,
  WASI_MAP_PUBLICATION,
  WASI_PUBLICATION_STATUS,
  WASI_RENT_PERIOD,
  Availability,
  MapPublication,
  PublicationStatus,
} from '../modules/properties/domain/property.enums';
import {
  PropertyPublication,
  PublicationState,
} from '../modules/publishing/domain/property-publication.entity';
import { Client } from '../modules/crm/domain/client.entity';
import { LeadSource } from '../modules/crm/domain/lead-source.entity';
import { Pipeline, PipelineStage } from '../modules/crm/domain/pipeline.entity';
import {
  InterestRole,
  PropertyInterest,
} from '../modules/crm/domain/property-interest.entity';
import {
  Activity,
  ActivityType,
} from '../modules/activity/domain/activity.entity';
import {
  WasiDump,
  bool,
  date,
  dateOnly,
  email as normalizeEmail,
  html,
  int,
  num,
  phoneKey,
  str,
  year,
} from './wasi-dump';

loadDotenv();
const env = validateEnv(process.env);
const DRY_RUN = process.argv.includes('--dry-run');
/** `--skip-images` reimporta datos sin volver a bajar las 6.340 fotos. */
const SKIP_IMAGES = process.argv.includes('--skip-images');
/**
 * Fotos en vuelo. El cuello de botella no es la red sino la recompresion, asi
 * que se ajusta al numero de nucleos: por encima solo hay contencion.
 * Se puede forzar con `--image-concurrency=N`.
 */
const IMAGE_CONCURRENCY = Number(
  process.argv
    .find((arg) => arg.startsWith('--image-concurrency='))
    ?.split('=')[1] ?? Math.max(2, cpus().length),
);
/** `--max-images=N` acota la descarga, util para probar el circuito completo. */
const MAX_IMAGES = Number(
  process.argv.find((arg) => arg.startsWith('--max-images='))?.split('=')[1] ??
    Infinity,
);

// El importador corre fuera de Nest, asi que el servicio se instancia a mano
// con un adaptador minimo de la configuracion.
const storage = new StorageService({
  uploadsDir: env.UPLOADS_DIR,
  uploadMaxBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
} as never);

/**
 * Importa el inventario y la cartera de WASI.
 *
 * Es idempotente: la clave es `wasiId` en cada tabla, de modo que relanzarlo
 * actualiza en lugar de duplicar. Requiere haber corrido antes `yarn seed`,
 * que deja los catalogos y los embudos en su sitio.
 */
async function main() {
  console.log(
    DRY_RUN ? 'Importacion de WASI (SIMULACION)\n' : 'Importacion de WASI\n',
  );
  await AppDataSource.initialize();
  try {
    const dump = new WasiDump(env.WASI_DUMP_DIR);
    console.log(`Volcado: ${dump.root}\n`);
    await assertSeeded(AppDataSource);

    const agents = await importAgents(AppDataSource, dump);
    const properties = await importProperties(AppDataSource, dump, agents);
    await importImages(AppDataSource, dump, properties);
    await importPublications(AppDataSource, dump, properties);
    const clients = await importClients(AppDataSource, dump, agents);
    await importInterests(AppDataSource, dump, properties, clients);
    await importClientNotes(AppDataSource, dump, clients, agents);

    console.log(
      DRY_RUN
        ? '\nSimulacion terminada: no se ha escrito nada.'
        : '\nImportacion terminada.',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

/**
 * Inserta en bloques.
 *
 * Con la base en el servidor, cada `save` individual cuesta una ida y vuelta:
 * los 7.529 clientes a fila por fila tardaban casi una hora. TypeORM convierte
 * un array en un INSERT multi-fila, asi que el lote reduce eso a decenas de
 * viajes.
 */
async function saveInChunks<T extends object>(
  repo: { save: (entities: T[]) => Promise<T[]> },
  rows: T[],
  label: string,
  size = 300,
): Promise<T[]> {
  const saved: T[] = [];
  for (let i = 0; i < rows.length; i += size) {
    saved.push(...(await repo.save(rows.slice(i, i + size))));
    if (rows.length > size) {
      process.stdout.write(
        `\r  ${label}: ${Math.min(i + size, rows.length)}/${rows.length}   `,
      );
    }
  }
  if (rows.length > size) process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return saved;
}

async function assertSeeded(db: DataSource) {
  const types = await db.getRepository(PropertyType).count();
  const pipelines = await db.getRepository(Pipeline).count();
  if (!types || !pipelines) {
    throw new Error('Faltan catalogos o embudos. Ejecuta primero `yarn seed`.');
  }
}

// --- asesores --------------------------------------------------------------

async function importAgents(
  db: DataSource,
  dump: WasiDump,
): Promise<Map<number, string>> {
  const repo = db.getRepository(Agent);
  const rows = dump.array<Record<string, unknown>>('users');

  // Todos los asesores importados nacen con la misma clave generica y con
  // `mustSetPassword` activo. Pueden entrar, pero `MustChangePasswordGuard` les
  // cierra el resto de la API hasta que la cambien: mientras la contrasena sea
  // compartida, la sesion no sirve para nada mas.
  const initialPasswordHash = await argon2.hash(env.DEFAULT_USER_PASSWORD, {
    type: argon2.argon2id,
  });

  // Los clientes referencian asesores que ya no aparecen en `users`: son bajas
  // (uno de ellos con mas de 1.200 clientes). Se crean como inactivos para no
  // perder a quien pertenece esa cartera.
  const referenced = new Set<number>();
  for (const client of dump.array<Record<string, unknown>>('clients')) {
    const id = int(client.id_user);
    if (id) referenced.add(id);
  }
  for (const property of dump.array<Record<string, unknown>>('properties')) {
    const id = int(property.id_user);
    if (id) referenced.add(id);
  }

  const known = new Set(rows.map((u) => Number(u.id_user)));
  const ghosts = [...referenced].filter((id) => !known.has(id));

  const mapping = new Map<number, string>();
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const wasiId = Number(row.id_user);
    const email =
      normalizeEmail(row.email) ??
      `usuario-${wasiId}@serrano-inmobiliaria.local`;

    const existing =
      (await repo.findOne({ where: { wasiId } })) ??
      (await repo.findOne({ where: { email } }));

    const data = {
      wasiId,
      firstName: str(row.first_name, 120) ?? `Asesor ${wasiId}`,
      lastName: str(row.last_name, 120),
      email,
      cellPhone: str(row.cell_phone, 32),
      hasWhatsapp: bool(row.with_whatsapp) || row.with_whatsapp === 1,
      photoUrl: str(row.photo),
      role:
        String(row.user_type).toUpperCase() === 'ADMIN'
          ? Role.ADMIN
          : Role.AGENT,
      status: AgentStatus.ACTIVE,
    };

    if (DRY_RUN) {
      mapping.set(wasiId, existing?.id ?? `dry-${wasiId}`);
      if (existing) updated++;
      else created++;
      continue;
    }

    const saved = existing
      ? await repo.save(Object.assign(existing, data))
      : await repo.save(
          repo.create({
            ...data,
            mustSetPassword: true,
            passwordHash: initialPasswordHash,
          }),
        );
    mapping.set(wasiId, saved.id);
    if (existing) updated++;
    else created++;
  }

  for (const wasiId of ghosts) {
    const existing = await repo.findOne({ where: { wasiId } });
    if (existing) {
      mapping.set(wasiId, existing.id);
      continue;
    }
    if (DRY_RUN) {
      mapping.set(wasiId, `dry-${wasiId}`);
      created++;
      continue;
    }
    const saved = await repo.save(
      repo.create({
        wasiId,
        firstName: 'Asesor retirado',
        lastName: String(wasiId),
        email: `retirado-${wasiId}@serrano-inmobiliaria.local`,
        role: Role.AGENT,
        status: AgentStatus.INACTIVE,
        mustSetPassword: true,
        passwordHash: initialPasswordHash,
      }),
    );
    mapping.set(wasiId, saved.id);
    created++;
  }

  console.log(
    `asesores: ${created} nuevos, ${updated} actualizados (${ghosts.length} recuperados de bajas)`,
  );
  return mapping;
}

// --- inmuebles -------------------------------------------------------------

async function importProperties(
  db: DataSource,
  dump: WasiDump,
  agents: Map<number, string>,
): Promise<Map<number, string>> {
  const repo = db.getRepository(Property);
  const assignments = db.getRepository(PropertyAssignment);

  const cities = new Set(
    (await db.getRepository(City).find({ select: { id: true } })).map(
      (c) => c.id,
    ),
  );
  const zones = new Set(
    (await db.getRepository(Zone).find({ select: { id: true } })).map(
      (z) => z.id,
    ),
  );
  const types = new Set(
    (await db.getRepository(PropertyType).find({ select: { id: true } })).map(
      (t) => t.id,
    ),
  );
  const features = await db.getRepository(Feature).find();
  const featureById = new Map(features.map((f) => [f.id, f]));
  const labels = await db.getRepository(PropertyLabel).find();
  const labelByWasiId = new Map(
    labels.filter((l) => l.wasiId).map((l) => [l.wasiId!, l]),
  );

  // `properties_detail` no aporta ningun campo extra sobre `properties` — lo
  // comprobamos campo a campo — asi que basta con el listado.
  const rows = dump.array<Record<string, unknown>>('properties');

  // Una sola consulta para saber que hay ya, en vez de un `findOne` por fila.
  const existingProps = new Map(
    (
      await repo.find({
        select: { id: true, wasiId: true },
        loadEagerRelations: false,
      })
    )
      .filter((p) => p.wasiId)
      .map((p) => [p.wasiId as number, p.id]),
  );

  const mapping = new Map<number, string>();
  const toInsert: Property[] = [];
  const toUpdate: Property[] = [];
  let skipped = 0;

  for (const row of rows) {
    const wasiId = Number(row.id_property);
    const cityId = int(row.id_city);
    const propertyTypeId = int(row.id_property_type);

    if (
      !cityId ||
      !cities.has(cityId) ||
      !propertyTypeId ||
      !types.has(propertyTypeId)
    ) {
      skipped++;
      continue;
    }

    const zoneId = int(row.id_zone);
    const labelWasiId = int(row.id_label);
    const agentId = agents.get(Number(row.id_user)) ?? null;

    const data = {
      wasiId,
      code: String(wasiId),
      title: str(row.title, 300) ?? `Inmueble ${wasiId}`,
      address: str(row.address, 300),
      publicUrl: str(row.link),

      forSale: bool(row.for_sale),
      forRent: bool(row.for_rent),
      forTransfer: bool(row.for_transfer),
      forTemporaryRent: bool(row.for_temporary_rent),

      salePrice: num(row.sale_price),
      rentPrice: num(row.rent_price),
      maintenanceFee: num(row.maintenance_fee),
      rentPeriod: WASI_RENT_PERIOD[int(row.id_rents_type) ?? 0] ?? null,
      currencyId: int(row.id_currency) ?? 1,

      propertyTypeId,
      cityId,
      zoneId: zoneId && zones.has(zoneId) ? zoneId : null,
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      mapPublication:
        WASI_MAP_PUBLICATION[int(row.id_publish_on_map) ?? 0] ??
        MapPublication.APPROXIMATE,

      area: num(row.area),
      builtArea: num(row.built_area),
      privateArea: num(row.private_area),
      bedrooms: int(row.bedrooms),
      bathrooms: int(row.bathrooms),
      garages: int(row.garages),
      floor: int(row.floor),
      stratum: int(row.stratum),
      condition: WASI_CONDITION[int(row.id_property_condition) ?? 0] ?? null,
      buildingYear: year(row.building_date),
      observations: html(row.observations),

      availability:
        WASI_AVAILABILITY[int(row.id_availability) ?? 0] ??
        Availability.AVAILABLE,
      publicationStatus:
        WASI_PUBLICATION_STATUS[int(row.id_status_on_page) ?? 0] ??
        PublicationStatus.ACTIVE,
      labelId: labelWasiId
        ? (labelByWasiId.get(labelWasiId)?.id ?? null)
        : null,
      visits: int(row.visits, { zeroIsNull: false }) ?? 0,

      videoUrl: str(row.video),
      tourUrl: str(row.url_360),
      wasiGalleryId: extractGalleryId(row.galleries),
      assignedAgentId: agentId,
    };

    const features = collectFeatureIds(row.features)
      .map((id) => featureById.get(id))
      .filter((f): f is Feature => Boolean(f));

    const existingId = existingProps.get(wasiId);
    if (existingId) {
      toUpdate.push(repo.create({ ...data, id: existingId, features }));
      mapping.set(wasiId, existingId);
    } else {
      toInsert.push(
        repo.create({
          ...data,
          features,
          createdAt: date(row.created_at) ?? undefined,
        }),
      );
    }
  }

  if (DRY_RUN) {
    for (const property of toInsert)
      mapping.set(property.wasiId as number, `dry-${property.wasiId}`);
    console.log(
      `inmuebles: ${toInsert.length} nuevos, ${toUpdate.length} actualizados${
        skipped ? `, ${skipped} omitidos por referencias invalidas` : ''
      }`,
    );
    return mapping;
  }

  const inserted = await saveInChunks(repo, toInsert, 'inmuebles', 100);
  for (const property of inserted)
    mapping.set(property.wasiId as number, property.id);
  await saveInChunks(repo, toUpdate, 'inmuebles (actualizando)', 100);

  // La captacion original: WASI solo conserva el asesor actual, asi que la
  // primera asignacion se fecha con el alta del inmueble.
  const newAssignments = inserted
    .filter((property) => property.assignedAgentId)
    .map((property) =>
      assignments.create({
        propertyId: property.id,
        agentId: property.assignedAgentId as string,
        role: AssignmentRole.CAPTURE,
        assignedAt: property.createdAt,
      }),
    );
  await saveInChunks(assignments, newAssignments, 'asignaciones', 300);

  const created = inserted.length;
  const updated = toUpdate.length;

  console.log(
    `inmuebles: ${created} nuevos, ${updated} actualizados${skipped ? `, ${skipped} omitidos por referencias invalidas` : ''}`,
  );
  return mapping;
}

/** `galleries` llega como `[{ "0": {...}, id: 9587986 }]`. */
function extractGalleryId(value: unknown): number | null {
  if (!Array.isArray(value) || !value.length) return null;
  const first = value[0] as Record<string, unknown>;
  return int(first?.id, { zeroIsNull: true });
}

function collectFeatureIds(value: unknown): number[] {
  if (!value || typeof value !== 'object') return [];
  const groups = value as { internal?: unknown[]; external?: unknown[] };
  return [...(groups.internal ?? []), ...(groups.external ?? [])]
    .map((f) => int((f as Record<string, unknown>)?.id))
    .filter((id): id is number => id !== null);
}

// --- imagenes --------------------------------------------------------------

async function importImages(
  db: DataSource,
  dump: WasiDump,
  properties: Map<number, string>,
) {
  const repo = db.getRepository(PropertyImage);
  const galleries = dump.collectionsById<{ id_gallery: number }>(
    'property_galleries',
  );
  const images =
    dump.collectionsById<Record<string, unknown>>('gallery_images');

  if (SKIP_IMAGES) {
    console.log('imagenes: omitidas (--skip-images)');
    return;
  }

  await storage.ensureRoot();

  // Se arma primero la lista completa de descargas para poder mostrar progreso
  // sobre un total real: con 6.340 fotos, un contador sin denominador no dice
  // nada de cuanto queda.
  interface Pending {
    propertyId: string;
    wasiImageId: number | null;
    url: string;
    description: string | null;
    position: number;
    isMain: boolean;
  }

  // Se lleva el control foto a foto, no inmueble a inmueble: si la
  // importacion se corta a la mitad de una galeria, al relanzarla se recogen
  // solo las que faltan en vez de dar el inmueble por hecho.
  const alreadyImported = new Set(
    DRY_RUN
      ? []
      : (
          await repo.find({
            select: { propertyId: true, wasiId: true },
            loadEagerRelations: false,
          })
        ).map((image) => `${image.propertyId}:${image.wasiId ?? ''}`),
  );

  const propertiesWithCover = new Set(
    DRY_RUN
      ? []
      : (
          await repo.find({
            where: { isMain: true },
            select: { propertyId: true },
            loadEagerRelations: false,
          })
        ).map((image) => image.propertyId),
  );

  const pending: Pending[] = [];
  let alreadyStored = 0;

  for (const [wasiPropertyId, propertyId] of properties) {
    const gallery = galleries.get(wasiPropertyId)?.[0];
    if (!gallery) continue;

    const rows = images.get(gallery.id_gallery) ?? [];
    if (!rows.length) continue;

    const sorted = [...rows].sort(
      (a, b) =>
        (int(a.position, { zeroIsNull: false }) ?? 0) -
        (int(b.position, { zeroIsNull: false }) ?? 0),
    );

    sorted.forEach((img, index) => {
      // `url_original` es el fichero sin las transformaciones del CDN de WASI:
      // es el unico que sirve para reprocesar a nuestros propios tamanos.
      const url = str(img.url_original) ?? str(img.url);
      if (!url) return;

      const wasiImageId = int(img.id_image);
      if (alreadyImported.has(`${propertyId}:${wasiImageId ?? ''}`)) {
        alreadyStored++;
        return;
      }

      pending.push({
        propertyId,
        wasiImageId,
        url,
        description: str(img.description, 300),
        position: index + 1,
        // Solo es portada si el inmueble no tenia ya fotos: al reanudar, la
        // primera pendiente no tiene por que ser la primera de la galeria.
        isMain: index === 0 && !propertiesWithCover.has(propertyId),
      });
    });
  }

  if (Number.isFinite(MAX_IMAGES) && pending.length > MAX_IMAGES) {
    console.log(
      `imagenes: se limita a ${MAX_IMAGES} de ${pending.length} por --max-images`,
    );
    pending.length = MAX_IMAGES;
  }

  if (DRY_RUN) {
    console.log(
      `imagenes: ${pending.length} se descargarian a ${storage.root}` +
        (alreadyStored ? `, ${alreadyStored} ya presentes` : ''),
    );
    return;
  }

  let done = 0;
  let failed = 0;
  let bytes = 0;
  const started = Date.now();
  // Las filas se acumulan y se escriben en bloques: el fichero ya esta en
  // disco, y hacer un INSERT por foto contra el servidor cuesta mas que la
  // propia descarga.
  let batch: PropertyImage[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    await repo.save(rows);
  };

  // Cola con concurrencia acotada: descargar, recomprimir a WebP y escribir.
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_CONCURRENCY, pending.length) },
      async () => {
        while (cursor < pending.length) {
          const item = pending[cursor++];
          const stored = await storage.saveFromUrl(
            item.url,
            `properties/${item.propertyId}`,
          );

          if (!stored) {
            failed++;
          } else {
            bytes += stored.bytes;
            await repo.save(
              repo.create({
                propertyId: item.propertyId,
                wasiId: item.wasiImageId,
                storageKey: stored.key,
                url: stored.url,
                urlLarge: stored.urlLarge,
                urlOriginal: stored.urlOriginal,
                sourceUrl: item.url,
                checksum: stored.checksum,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                description: item.description,
                position: item.position,
                isMain: item.isMain,
              }),
            );
          }

          done++;
          if (done % 25 === 0 || done === pending.length) {
            const pct = Math.round((done / pending.length) * 100);
            process.stdout.write(
              `\r  descargando imagenes: ${done}/${pending.length} (${pct}%)  ${mb(bytes)}   `,
            );
          }
        }
      },
    ),
  );

  await flush();
  if (pending.length) process.stdout.write('\n');

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `imagenes: ${done - failed} guardadas en ${storage.root} (${mb(bytes)}, ${seconds}s)` +
      (failed ? `, ${failed} fallidas` : '') +
      (alreadyStored
        ? `, ${alreadyStored} omitidas porque el inmueble ya tenia fotos`
        : ''),
  );
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// --- publicaciones en portales ---------------------------------------------

async function importPublications(
  db: DataSource,
  dump: WasiDump,
  properties: Map<number, string>,
) {
  const repo = db.getRepository(PropertyPublication);
  const portals = new Set(
    (await db.getRepository(Portal).find({ select: { id: true } })).map(
      (p) => p.id,
    ),
  );
  const perProperty =
    dump.collectionsById<Record<string, unknown>>('property_portals');

  // Los pares ya presentes se leen de una vez: 6.602 `findOne` eran 6.602
  // idas y vueltas al servidor.
  const existing = new Set(
    (
      await repo.find({
        select: { propertyId: true, portalId: true },
        loadEagerRelations: false,
      })
    ).map((p) => `${p.propertyId}:${p.portalId}`),
  );

  const toInsert: PropertyPublication[] = [];

  for (const [wasiPropertyId, propertyId] of properties) {
    for (const row of perProperty.get(wasiPropertyId) ?? []) {
      const portalId = Number(row.id);
      if (!bool(row.active) || !portals.has(portalId)) continue;
      if (existing.has(`${propertyId}:${portalId}`)) continue;

      toInsert.push(
        repo.create({
          propertyId,
          portalId,
          // En WASI `active` significa que el anuncio esta arriba en el portal.
          state: PublicationState.PUBLISHED,
          publishedAt: new Date(),
        }),
      );
    }
  }

  if (!DRY_RUN) await saveInChunks(repo, toInsert, 'publicaciones', 500);
  console.log(`publicaciones en portales: ${toInsert.length}`);
}

// --- clientes --------------------------------------------------------------

async function importClients(
  db: DataSource,
  dump: WasiDump,
  agents: Map<number, string>,
): Promise<Map<number, string>> {
  const repo = db.getRepository(Client);
  const stages = await db.getRepository(PipelineStage).find();
  const pipelines = await db.getRepository(Pipeline).find();
  const sources = await db.getRepository(LeadSource).find();
  const clientTypes = await db.getRepository(ClientType).find();
  const cities = new Set(
    (await db.getRepository(City).find({ select: { id: true } })).map(
      (c) => c.id,
    ),
  );

  const stageByWasiId = new Map(
    stages.filter((s) => s.wasiId).map((s) => [s.wasiId!, s]),
  );
  const pipelineByWasiId = new Map(
    pipelines.filter((p) => p.wasiId).map((p) => [p.wasiId!, p]),
  );
  const typeById = new Map(clientTypes.map((t) => [t.id, t]));
  const fallbackPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const fallbackStage = stages
    .filter((s) => s.pipelineId === fallbackPipeline?.id)
    .sort((a, b) => a.position - b.position)[0];

  // Indice alias -> fuente, para resolver el campo libre `reference`.
  const sourceByAlias = new Map<string, LeadSource>();
  for (const source of sources) {
    sourceByAlias.set(source.name.toLowerCase(), source);
    for (const alias of source.aliases)
      sourceByAlias.set(alias.toLowerCase(), source);
  }

  const rows = dump.array<Record<string, unknown>>('clients');

  // Se lee de una vez lo que ya existe: 7.529 `findOne` contra el servidor
  // eran casi una hora solo en latencia.
  const existingClients = new Map(
    (
      await repo.find({
        select: { id: true, wasiId: true },
        loadEagerRelations: false,
      })
    )
      .filter((c) => c.wasiId)
      .map((c) => [c.wasiId as number, c.id]),
  );

  const mapping = new Map<number, string>();
  const toInsert: Client[] = [];
  const toUpdate: Client[] = [];
  let skipped = 0;

  for (const row of rows) {
    const wasiId = Number(row.id_client);
    const stage =
      stageByWasiId.get(int(row.id_client_status) ?? -1) ?? fallbackStage;
    const pipeline =
      pipelineByWasiId.get(int(row.id_pipeline) ?? -1) ??
      pipelines.find((p) => p.id === stage?.pipelineId) ??
      fallbackPipeline;

    if (!stage || !pipeline) {
      skipped++;
      continue;
    }

    const cityId = int(row.id_city);
    const cellPhone = str(row.cell_phone, 40);
    const phone = str(row.phone, 40);

    const data = {
      wasiId,
      firstName: str(row.first_name, 160) ?? `Cliente ${wasiId}`,
      lastName: str(row.last_name, 160),
      email: normalizeEmail(row.email),
      cellPhone,
      phone,
      phoneNormalized: phoneKey(cellPhone ?? phone),
      identification: str(row.identification, 40),
      birthday: dateOnly(row.birthday),
      // La etapa manda: si el embudo declarado no cuadra con ella, gana la etapa.
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      stageChangedAt: date(row.updated_at) ?? date(row.created_at),
      sourceId: resolveSource(row.reference, sourceByAlias)?.id ?? null,
      cityId: cityId && cities.has(cityId) ? cityId : null,
      assignedAgentId: agents.get(Number(row.id_user)) ?? null,
      requirement: html(row.query),
      notes: html(row.comment),
      acceptsMarketing: bool(row.send_information),
      lastContactedAt: date(row.updated_at),
    };

    const types = extractClientTypeIds(row)
      .map((id) => typeById.get(id))
      .filter((t): t is ClientType => Boolean(t));

    const existingId = existingClients.get(wasiId);
    if (existingId) {
      toUpdate.push(repo.create({ ...data, id: existingId, types }));
      mapping.set(wasiId, existingId);
    } else {
      toInsert.push(
        repo.create({
          ...data,
          types,
          createdAt: date(row.created_at) ?? undefined,
        }),
      );
    }
  }

  if (DRY_RUN) {
    for (const client of toInsert)
      mapping.set(client.wasiId as number, `dry-${client.wasiId}`);
    console.log(
      `clientes: ${toInsert.length} nuevos, ${toUpdate.length} actualizados${
        skipped ? `, ${skipped} omitidos sin etapa` : ''
      }`,
    );
    return mapping;
  }

  const inserted = await saveInChunks(repo, toInsert, 'clientes', 250);
  for (const client of inserted)
    mapping.set(client.wasiId as number, client.id);
  await saveInChunks(repo, toUpdate, 'clientes (actualizando)', 250);

  console.log(
    `clientes: ${inserted.length} nuevos, ${toUpdate.length} actualizados${
      skipped ? `, ${skipped} omitidos sin etapa` : ''
    }`,
  );
  return mapping;
}

function resolveSource(
  reference: unknown,
  index: Map<string, LeadSource>,
): LeadSource | undefined {
  const text = str(reference)?.toLowerCase();
  if (!text) return undefined;
  const exact = index.get(text);
  if (exact) return exact;
  // Coincidencia parcial: "doomos.info" contra el alias "doomos".
  for (const [alias, source] of index) {
    if (alias.length >= 4 && text.includes(alias)) return source;
  }
  return undefined;
}

function extractClientTypeIds(row: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  const main = int(row.id_client_type);
  if (main) ids.add(main);
  if (Array.isArray(row.client_types)) {
    for (const entry of row.client_types) {
      const id = int((entry as Record<string, unknown>)?.id_client_type);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

// --- intereses cliente <-> inmueble ----------------------------------------

/** El tipo de cliente en WASI define su papel respecto al inmueble. */
const INTEREST_ROLE_BY_CLIENT_TYPE: Record<number, InterestRole> = {
  1: InterestRole.BUYER, // Comprador
  2: InterestRole.SELLER, // Vendedor
  3: InterestRole.SELLER, // Arrendador
  4: InterestRole.TENANT, // Arrendatario
  5: InterestRole.OWNER, // Propietario
  7: InterestRole.PROSPECT, // Buscando
  11: InterestRole.TENANT, // Inquilino
};

async function importInterests(
  db: DataSource,
  dump: WasiDump,
  properties: Map<number, string>,
  clients: Map<number, string>,
) {
  const repo = db.getRepository(PropertyInterest);
  const perProperty =
    dump.collectionsById<Record<string, unknown>>('property_clients');

  const existing = new Set(
    (
      await repo.find({
        select: { clientId: true, propertyId: true, role: true },
        loadEagerRelations: false,
      })
    ).map((i) => `${i.clientId}:${i.propertyId}:${i.role}`),
  );

  const seen = new Set<string>();
  const toInsert: PropertyInterest[] = [];
  let orphans = 0;

  for (const [wasiPropertyId, propertyId] of properties) {
    for (const row of perProperty.get(wasiPropertyId) ?? []) {
      const clientId = clients.get(Number(row.id_client));
      if (!clientId) {
        orphans++;
        continue;
      }

      const role =
        INTEREST_ROLE_BY_CLIENT_TYPE[int(row.id_client_type) ?? 0] ??
        InterestRole.PROSPECT;
      const key = `${clientId}:${propertyId}:${role}`;
      // El volcado repite pares; el indice unico los rechazaria a mitad del lote.
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);

      toInsert.push(repo.create({ clientId, propertyId, role }));
    }
  }

  if (!DRY_RUN) await saveInChunks(repo, toInsert, 'intereses', 500);
  console.log(
    `intereses cliente-inmueble: ${toInsert.length}${
      orphans ? `, ${orphans} descartados por cliente inexistente` : ''
    }`,
  );
}

// --- bitacora --------------------------------------------------------------

/**
 * Convierte en actividades las notas que la agencia venia escribiendo dentro de
 * `comment` y `query`. Ahi es donde esta el historico real de gestion: sin esto
 * quedarian como un bloque de texto en la ficha, imposible de consultar.
 */
async function importClientNotes(
  db: DataSource,
  dump: WasiDump,
  clients: Map<number, string>,
  agents: Map<number, string>,
) {
  const repo = db.getRepository(Activity);

  const already = new Set(
    (
      await repo.find({
        where: { type: ActivityType.NOTE },
        select: { clientId: true },
        loadEagerRelations: false,
      })
    )
      .map((a) => a.clientId)
      .filter((id): id is string => Boolean(id)),
  );

  const toInsert: Activity[] = [];

  for (const row of dump.array<Record<string, unknown>>('clients')) {
    const clientId = clients.get(Number(row.id_client));
    if (!clientId || already.has(clientId)) continue;

    const note = html(row.comment);
    if (!note) continue;

    toInsert.push(
      repo.create({
        type: ActivityType.NOTE,
        clientId,
        agentId: agents.get(Number(row.id_user)) ?? null,
        summary: note.slice(0, 300),
        detail: note.length > 300 ? note : null,
        occurredAt: date(row.updated_at) ?? date(row.created_at) ?? new Date(),
        automatic: false,
      }),
    );
  }

  if (!DRY_RUN) await saveInChunks(repo, toInsert, 'notas', 500);
  console.log(`notas migradas a la bitacora: ${toInsert.length}`);
}

main().catch((error: unknown) => {
  console.error(
    '\nFallo la importacion:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
