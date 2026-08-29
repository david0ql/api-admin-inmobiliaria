import 'reflect-metadata';
import * as argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../shared/database/data-source';
import { validateEnv } from '../shared/config/env.schema';
import {
  City,
  Country,
  Region,
  Zone,
} from '../modules/catalog/domain/geography.entity';
import {
  ClientType,
  Currency,
  Feature,
  FeatureScope,
  Portal,
  PropertyType,
} from '../modules/catalog/domain/catalogs.entity';
import { Agent } from '../modules/iam/domain/agent.entity';
import { AgentStatus, Role } from '../modules/iam/domain/role.enum';
import { Pipeline, PipelineStage } from '../modules/crm/domain/pipeline.entity';
import { LeadSource } from '../modules/crm/domain/lead-source.entity';
import { PropertyLabel } from '../modules/properties/domain/property-label.entity';
import { WasiDump, bool, str, toArray } from './wasi-dump';

loadDotenv();
const env = validateEnv(process.env);

/**
 * Siembra los catalogos y la estructura comercial.
 *
 * Es idempotente: se puede volver a lanzar sin duplicar nada. Solo carga datos
 * de referencia — inmuebles y clientes van en `import:wasi`.
 */
async function seed(db: DataSource) {
  const dump = new WasiDump(env.WASI_DUMP_DIR);
  console.log(`Volcado: ${dump.root}\n`);

  await seedGeography(db, dump);
  await seedCatalogs(db, dump);
  await seedPipelines(db);
  await seedLeadSources(db);
  await seedPropertyLabels(db);
  await seedAdmin(db);
}

// --- geografia -------------------------------------------------------------

async function seedGeography(db: DataSource, dump: WasiDump) {
  const countries = dump
    .array<{ id_country: number; name: string; iso?: string }>(
      'geography/countries',
    )
    .map((c) => ({ id: c.id_country, name: c.name, iso: str(c.iso, 8) }));
  await upsert(db, Country, countries, 'paises');

  // `regions_by_country` viene indexado por pais; se aplana conservando el
  // vinculo, y se descartan regiones de paises que no llegaron en el volcado.
  const countryIds = new Set(countries.map((c) => c.id));
  const regions = [
    ...dump
      .collectionsById<{ id_region: number; name: string; id_country: number }>(
        'geography/regions_by_country',
      )
      .values(),
  ]
    .flat()
    .filter((r) => countryIds.has(r.id_country))
    .map((r) => ({ id: r.id_region, name: r.name, countryId: r.id_country }));
  await upsert(db, Region, dedupe(regions), 'regiones');

  const regionIds = new Set(regions.map((r) => r.id));
  const cities = [
    ...dump
      .collectionsById<{ id_city: number; name: string; id_region: number }>(
        'geography/cities_by_region',
      )
      .values(),
  ]
    .flat()
    .filter((c) => regionIds.has(c.id_region))
    .map((c) => ({ id: c.id_city, name: c.name, regionId: c.id_region }));

  // Las ciudades de los inmuebles pueden no estar en `cities_by_region` si la
  // region no se descargo entera: se completan desde el propio inventario.
  for (const property of dump.array<Record<string, unknown>>('properties')) {
    const id = Number(property.id_city);
    const regionId = Number(property.id_region);
    if (id && regionIds.has(regionId) && !cities.some((c) => c.id === id)) {
      cities.push({
        id,
        name: str(property.city_label, 160) ?? `Ciudad ${id}`,
        regionId,
      });
    }
  }
  await upsert(db, City, dedupe(cities), 'ciudades');

  const cityIds = new Set(cities.map((c) => c.id));
  const zones = [
    ...dump
      .collectionsById<{ id_zone: number; name: string; id_city: number }>(
        'geography/zones_by_city',
      )
      .values(),
  ]
    .flat()
    .filter((z) => cityIds.has(z.id_city))
    .map((z) => ({ id: z.id_zone, name: z.name, cityId: z.id_city }));

  for (const property of dump.array<Record<string, unknown>>('properties')) {
    const id = Number(property.id_zone);
    const cityId = Number(property.id_city);
    if (id && cityIds.has(cityId) && !zones.some((z) => z.id === id)) {
      zones.push({
        id,
        name: str(property.zone_label, 200) ?? `Zona ${id}`,
        cityId,
      });
    }
  }
  await upsert(db, Zone, dedupe(zones), 'zonas');
}

// --- catalogos -------------------------------------------------------------

async function seedCatalogs(db: DataSource, dump: WasiDump) {
  const types = dump
    .array<{ id_property_type: number; nombre?: string; name?: string }>(
      'catalogs/property_types',
    )
    .map((t) => ({
      id: t.id_property_type,
      name: t.nombre || t.name || `Tipo ${t.id_property_type}`,
      active: true,
    }));
  await upsert(db, PropertyType, types, 'tipos de inmueble');

  // Las caracteristicas llegan separadas en dos bloques dentro del mismo
  // fichero; sus ids no colisionan, asi que caben en una sola tabla con scope.
  const raw = dump.read<Record<string, unknown>>('catalogs/features') ?? {};
  const features = [
    ...toArray<{ id: number; nombre?: string; name?: string }>(
      raw.internal,
    ).map((f) => ({
      id: f.id,
      name: f.nombre || f.name || `Caracteristica ${f.id}`,
      scope: FeatureScope.INTERNAL,
    })),
    ...toArray<{ id: number; nombre?: string; name?: string }>(
      raw.external,
    ).map((f) => ({
      id: f.id,
      name: f.nombre || f.name || `Caracteristica ${f.id}`,
      scope: FeatureScope.EXTERNAL,
    })),
  ];
  await upsert(db, Feature, dedupe(features), 'caracteristicas');

  const currencies = dump
    .array<{ id_currency: number; iso: string; name: string }>(
      'catalogs/currencies',
    )
    .map((c) => ({ id: c.id_currency, iso: c.iso, name: c.name }));
  await upsert(db, Currency, currencies, 'monedas');

  const clientTypes = dump
    .array<{ id_client_type: number; nombre?: string; name?: string }>(
      'catalogs/client_types',
    )
    .map((t) => ({
      id: t.id_client_type,
      name: t.nombre || t.name || `Tipo ${t.id_client_type}`,
    }));
  await upsert(db, ClientType, clientTypes, 'tipos de cliente');

  const portals = dump
    .array<{
      id: number;
      name: string;
      paid?: boolean;
      is_connected?: boolean;
    }>('catalogs/portals')
    .map((p) => ({
      id: p.id,
      // Los nombres traen HTML incrustado: "Proppit <small>(...)</small>".
      name: (
        str(p.name.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 160) ??
        `Portal ${p.id}`
      ).trim(),
      paid: bool(p.paid),
      connected: bool(p.is_connected),
    }));
  await upsert(db, Portal, portals, 'portales');
}

// --- estructura comercial --------------------------------------------------

/**
 * Los tres embudos que la agencia ya usaba, con la semantica que WASI no
 * guardaba: que etapa significa ganado y cual perdido.
 */
const PIPELINES = [
  {
    name: 'Clientes',
    wasiId: 1,
    isDefault: true,
    position: 0,
    stages: [
      { name: 'Nuevo', wasiId: 1, color: '#3b82f6' },
      { name: 'En Proceso', wasiId: 2, color: '#f59e0b' },
      { name: 'Convertido', wasiId: 3, color: '#16a34a', isWon: true },
      { name: 'Recuperado', wasiId: 4, color: '#8b5cf6' },
      { name: 'Perdido', wasiId: 5, color: '#ef4444', isLost: true },
    ],
  },
  {
    name: 'Customer Journey',
    wasiId: 6981,
    position: 1,
    stages: [
      { name: 'Nuevo', wasiId: 30155, color: '#3b82f6' },
      { name: 'Contactado', wasiId: 30156, color: '#0ea5e9' },
      { name: 'En Proceso', wasiId: 30158, color: '#f59e0b' },
      { name: 'Convertido', wasiId: 30159, color: '#16a34a', isWon: true },
      { name: 'Recuperado', wasiId: 30160, color: '#8b5cf6' },
      { name: 'Perdido', wasiId: 30161, color: '#ef4444', isLost: true },
    ],
  },
  {
    name: 'Propietarios',
    wasiId: 6993,
    position: 2,
    stages: [
      { name: 'Nuevo', wasiId: 30182, color: '#3b82f6' },
      { name: 'Fotografía', wasiId: 30185, color: '#a855f7' },
      { name: 'En Publicación', wasiId: 30188, color: '#f59e0b' },
      { name: 'Publicado', wasiId: 30193, color: '#16a34a', isWon: true },
    ],
  },
];

async function seedPipelines(db: DataSource) {
  const pipelines = db.getRepository(Pipeline);
  const stages = db.getRepository(PipelineStage);
  let created = 0;

  for (const definition of PIPELINES) {
    let pipeline = await pipelines.findOne({
      where: { name: definition.name },
    });
    if (!pipeline) {
      pipeline = await pipelines.save(
        pipelines.create({
          name: definition.name,
          wasiId: definition.wasiId,
          isDefault: definition.isDefault ?? false,
          position: definition.position,
        }),
      );
      created++;
    }

    for (const [index, stage] of definition.stages.entries()) {
      const exists = await stages.findOne({
        where: { pipelineId: pipeline.id, name: stage.name },
      });
      if (exists) continue;
      await stages.save(
        stages.create({
          pipelineId: pipeline.id,
          name: stage.name,
          wasiId: stage.wasiId,
          position: index,
          color: stage.color,
          isWon: 'isWon' in stage ? stage.isWon : false,
          isLost: 'isLost' in stage ? stage.isLost : false,
        }),
      );
    }
  }
  console.log(`  embudos: ${PIPELINES.length} (${created} nuevos)`);
}

/**
 * Canales de captacion. Los alias recogen las variantes con que el mismo canal
 * aparece escrito en el campo libre `reference` de WASI.
 */
const LEAD_SOURCES = [
  {
    name: 'Proppit',
    paid: true,
    aliases: [
      'Proppit',
      'proppit',
      'puntopropiedad',
      'properati',
      'trovit',
      'mitula',
    ],
  },
  {
    name: 'Página web',
    paid: false,
    aliases: ['Página web', 'Pagina web', 'Web', 'web'],
  },
  {
    name: 'Mercadolibre',
    paid: true,
    aliases: ['Mercadolibre', 'MercadoLibre', 'mercadolibre'],
  },
  { name: 'Doomos', paid: true, aliases: ['doomos.info', 'Doomos', 'doomos'] },
  {
    name: 'Fincaraiz',
    paid: true,
    aliases: ['Fincaraiz', 'fincaraiz', 'Finca Raiz'],
  },
  {
    name: 'Metrocuadrado',
    paid: true,
    aliases: ['Metrocuadrado', 'metrocuadrado'],
  },
  {
    name: 'Luxury Estate',
    paid: true,
    aliases: ['luxuryestate.com', 'Luxury estate'],
  },
  {
    name: 'Facebook',
    paid: false,
    aliases: ['Facebook', 'facebook', 'Redes Sociales'],
  },
  { name: 'Referido', paid: false, aliases: ['Referido', 'Recomendado'] },
  { name: 'Llamada directa', paid: false, aliases: ['Llamada', 'Telefono'] },
  { name: 'Valla / oficina', paid: false, aliases: ['Valla', 'Oficina'] },
];

async function seedLeadSources(db: DataSource) {
  const repo = db.getRepository(LeadSource);
  let created = 0;
  for (const source of LEAD_SOURCES) {
    if (await repo.findOne({ where: { name: source.name } })) continue;
    await repo.save(repo.create(source));
    created++;
  }
  console.log(
    `  fuentes de captacion: ${LEAD_SOURCES.length} (${created} nuevas)`,
  );
}

async function seedPropertyLabels(db: DataSource) {
  const repo = db.getRepository(PropertyLabel);
  const labels = [
    { name: 'Disponible', color: '#6aa84f', wasiId: 98036 },
    { name: 'Alquilado', color: '#f1c232', wasiId: 98037 },
    { name: 'Reservado', color: '#3b82f6', wasiId: null },
    { name: 'En trámite', color: '#a855f7', wasiId: null },
  ];
  let created = 0;
  for (const label of labels) {
    if (await repo.findOne({ where: { name: label.name } })) continue;
    await repo.save(repo.create(label));
    created++;
  }
  console.log(`  etiquetas: ${labels.length} (${created} nuevas)`);
}

async function seedAdmin(db: DataSource) {
  const repo = db.getRepository(Agent);
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();

  if (await repo.findOne({ where: { email } })) {
    console.log(`  administrador: ${email} (ya existia)`);
    return;
  }

  await repo.save(
    repo.create({
      firstName: 'Administrador',
      lastName: 'Serrano',
      email,
      passwordHash: await argon2.hash(env.SEED_ADMIN_PASSWORD, {
        type: argon2.argon2id,
      }),
      mustSetPassword: false,
      role: Role.ADMIN,
      status: AgentStatus.ACTIVE,
      hasWhatsapp: false,
    }),
  );
  console.log(`  administrador: ${email} (creado)`);
}

// --- utilidades ------------------------------------------------------------

/**
 * Inserta lo que falte y NO toca lo que ya existe.
 *
 * Antes actualizaba por clave primaria, y eso convertia el sembrado en un
 * arma: los catalogos salen del volcado de WASI, asi que cada ejecucion
 * reescribia los nombres con los del volcado y devolvia a la vida las filas
 * que se habian dado de baja a mano. Paso de verdad —un `yarn seed` deshizo
 * la homologacion entera: los municipios perdieron las tildes, 'Ph' y
 * 'Terreno' volvieron al selector, y 'Ruitoque Resort' volvio a estar cinco
 * veces— y nada fallo, porque un upsert no falla nunca.
 *
 * El sembrado existe para poblar una base vacia, no para imponer el volcado
 * sobre un sistema que ya vive. Lo que la agencia corrige desde el panel manda
 * sobre el fichero de origen, y por eso aqui solo se insertan las filas que no
 * estan. Para reimportar de WASI a proposito esta `import:wasi`, que es un
 * comando aparte y se ejecuta sabiendo lo que se hace.
 */
async function upsert<T extends object>(
  db: DataSource,
  entity: new () => T,
  rows: T[],
  label: string,
) {
  if (!rows.length) {
    console.log(`  ${label}: 0`);
    return;
  }
  const repo = db.getRepository(entity);
  let insertadas = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const bloque = rows.slice(i, i + 500);
    const { identifiers } = await repo
      .createQueryBuilder()
      .insert()
      .values(bloque)
      .orIgnore()
      .execute();
    insertadas += identifiers.filter(Boolean).length;
  }
  console.log(`  ${label}: ${insertadas} nuevas de ${rows.length}`);
}

function dedupe<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Map<number, T>();
  for (const row of rows) seen.set(row.id, row);
  return [...seen.values()];
}

// --- entrada ---------------------------------------------------------------

async function main() {
  console.log('Sembrando catalogos y estructura comercial\n');
  await AppDataSource.initialize();
  try {
    await seed(AppDataSource);
    console.log('\nListo.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    '\nFallo la siembra:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
