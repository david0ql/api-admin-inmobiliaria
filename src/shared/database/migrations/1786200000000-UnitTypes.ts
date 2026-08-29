import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tipologías de verdad: una tabla, no un cálculo.
 *
 * Antes se agrupaba al vuelo por `property.unit_type`, una columna de texto
 * vacía en los 642 inmuebles: por eso todo salía como "Sin clasificar". Se
 * agrupaba por nada.
 *
 * Esta migración hace tres cosas y en este orden:
 *  1. Crea la tabla y el enlace desde el inmueble.
 *  2. Agrupa lo que está en el mismo sitio y no tiene proyecto —92 grupos, 246
 *     inmuebles que comparten barrio y dirección exacta— creando un proyecto
 *     por grupo. Nacen SIN publicar: son edificios deducidos de los datos, y
 *     que aparezcan en la web es una decisión de la agencia, no mía.
 *  3. Escribe las tipologías de cada proyecto y asigna cada inmueble a la
 *     suya.
 */
export class UnitTypes1786200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TYPE "unit_type_kind_enum" AS ENUM ('FIXED', 'AUTO')`);

    await q.query(`
      CREATE TABLE "unit_type" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "family_id" uuid NOT NULL REFERENCES "property_family"("id") ON DELETE CASCADE,
        "code" varchar(8) NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text,
        "kind" "unit_type_kind_enum" NOT NULL DEFAULT 'FIXED',
        "bedrooms" smallint,
        "bathrooms" smallint,
        "garages" smallint,
        "area_min" numeric(12,2),
        "area_max" numeric(12,2),
        "built_area" numeric(12,2),
        "position" smallint NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_unit_type_family_code" UNIQUE ("family_id", "code")
      )`);
    await q.query(
      `CREATE INDEX "IDX_unit_type_family" ON "unit_type" ("family_id")`,
    );

    await q.query(`
      ALTER TABLE "property"
        ADD COLUMN "unit_type_id" uuid
        REFERENCES "unit_type"("id") ON DELETE SET NULL`);
    await q.query(
      `CREATE INDEX "IDX_property_unit_type" ON "property" ("unit_type_id")`,
    );

    await this.agruparPorSitio(q);
    await this.escribirTipologias(q);

    /*
      La columna vieja se va. Estaba vacía en los 642 y dejarla seria tener dos
      sitios donde vive la misma idea: el dia que alguien escriba ahi, la web
      enseñaria una cosa y el panel otra.
    */
    await q.query(`ALTER TABLE "property" DROP COLUMN IF EXISTS "unit_type"`);
  }

  /**
   * Un proyecto por cada sitio repetido.
   *
   * "El mismo lugar" se decide por barrio + dirección exacta, que es lo único
   * fiable que hay: el título lleva el nombre del conjunto pero escrito a mano
   * y de tres formas distintas. Con dos inmuebles basta —dos apartamentos en
   * la misma dirección son el mismo edificio— y el nombre sale del conjunto
   * que aparece en el título, o de la dirección si no se puede sacar.
   */
  private async agruparPorSitio(q: QueryRunner): Promise<void> {
    const grupos = (await q.query(`
      SELECT p.zone_id,
             lower(trim(p.address)) AS direccion,
             count(*)::int AS n,
             min(p.branch_id::text) AS branch_id,
             min(p.city_id) AS city_id,
             min(p.address) AS address,
             min(z.name) AS zona
      FROM property p
      LEFT JOIN zone z ON z.id = p.zone_id
      WHERE p.deleted_at IS NULL
        AND p.family_id IS NULL
        AND p.address IS NOT NULL
        AND length(trim(p.address)) > 4
      GROUP BY p.zone_id, lower(trim(p.address))
      HAVING count(*) > 1
    `)) as {
      zone_id: number | null;
      direccion: string;
      n: number;
      branch_id: string;
      city_id: number;
      address: string;
      zona: string | null;
    }[];

    for (const grupo of grupos) {
      /*
        Un sitio repetido no es siempre un proyecto. En "Carrera 5 #15-61" hay
        cinco inmuebles y los cinco son distintos: un apartaestudio de 20 m²,
        otro de 26, y apartamentos de 40, 52 y 67. Eso es un edificio viejo con
        cinco pisos distintos, no un proyecto con tipologias, y forzarlo daria
        cinco "tipologias" de una unidad cada una: renombrar, no agrupar.

        La señal de que hay tipologias es que algo SE REPITA. Si ninguna unidad
        se parece a otra, el grupo se queda como esta hoy: inmuebles sueltos.
      */
      const unidades = await this.unidadesDe(q, grupo.direccion, grupo.zone_id);
      if (!agrupar(unidades).some((c) => c.length > 1)) continue;

      const nombre = `${grupo.address}${grupo.zona ? ` · ${grupo.zona}` : ''}`;
      const slug = await this.slugLibre(q, nombre);

      const [familia] = (await q.query(
        `INSERT INTO "property_family"
           ("name", "slug", "kind", "status", "city_id", "zone_id", "address",
            "published", "branch_id")
         VALUES ($1, $2, 'COMPLEX', 'DELIVERED', $3, $4, $5, false, $6)
         RETURNING id`,
        [
          nombre.slice(0, 200),
          slug,
          grupo.city_id,
          grupo.zone_id,
          grupo.address,
          grupo.branch_id,
        ],
      )) as { id: string }[];

      await q.query(
        `UPDATE "property" SET "family_id" = $1
         WHERE "family_id" IS NULL AND "deleted_at" IS NULL
           AND lower(trim("address")) = $2
           AND ("zone_id" = $3 OR ($3 IS NULL AND "zone_id" IS NULL))`,
        [familia.id, grupo.direccion, grupo.zone_id],
      );
    }
  }

  /** Las unidades de un sitio todavia sin proyecto. */
  private async unidadesDe(
    q: QueryRunner,
    direccion: string,
    zoneId: number | null,
  ): Promise<Unidad[]> {
    return (await q.query(
      `SELECT p.id, p.property_type_id, pt.name AS tipo, p.bedrooms, p.bathrooms,
              p.garages, p.area::float AS area, p.built_area::float AS built
       FROM "property" p
       JOIN "property_type" pt ON pt.id = p.property_type_id
       WHERE p.family_id IS NULL AND p.deleted_at IS NULL
         AND lower(trim(p.address)) = $1
         AND (p.zone_id = $2 OR ($2 IS NULL AND p.zone_id IS NULL))`,
      [direccion, zoneId],
    )) as Unidad[];
  }

  /** El slug tiene que ser único: dos edificios pueden llamarse igual. */
  private async slugLibre(q: QueryRunner, nombre: string): Promise<string> {
    const base =
      nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200) || 'proyecto';

    for (let intento = 0; intento < 50; intento++) {
      const slug = intento ? `${base}-${intento + 1}` : base;
      const [existe] = (await q.query(
        `SELECT 1 FROM "property_family" WHERE "slug" = $1 LIMIT 1`,
        [slug],
      )) as unknown[];
      if (!existe) return slug;
    }
    return `${base}-${Date.now()}`;
  }

  /**
   * Las tipologías de cada proyecto, y a cuál pertenece cada inmueble.
   *
   * Dos reglas, porque son dos cosas distintas:
   *  - Lo habitable se agrupa por lo que la gente compara: tipo, alcobas,
   *    baños y área redondeada a la decena. Sin redondear, 58 y 58,4 m² serian
   *    dos tipologias donde hay una.
   *  - El suelo se agrupa por TRAMO de área, y queda marcado como automático.
   *    No hay dos lotes iguales: agruparlos por alcobas —que no tienen— daria
   *    una sola tipologia con todo dentro, y escribir una por lote daria una
   *    por inmueble. El tramo es lo único que separa un lote de 600 m² de uno
   *    de 1.400.
   */
  private async escribirTipologias(q: QueryRunner): Promise<void> {
    const familias = (await q.query(
      `SELECT DISTINCT f.id FROM "property_family" f
       JOIN "property" p ON p.family_id = f.id AND p.deleted_at IS NULL`,
    )) as { id: string }[];

    for (const familia of familias) {
      const unidades = (await q.query(
        `SELECT p.id, p.property_type_id, pt.name AS tipo, p.bedrooms, p.bathrooms,
                p.garages, p.area::float AS area, p.built_area::float AS built
         FROM "property" p
         JOIN "property_type" pt ON pt.id = p.property_type_id
         WHERE p.family_id = $1 AND p.deleted_at IS NULL`,
        [familia.id],
      )) as Unidad[];

      const grupos = agrupar(unidades);

      let posicion = 0;
      let letra = 0;
      let numeroSuelo = 0;

      for (const miembros of grupos) {
        const suelo = esSuelo(miembros[0].tipo);
        const areas = miembros
          .map((m) => m.area)
          .filter((a): a is number => typeof a === 'number' && a > 0);
        const min = areas.length ? Math.min(...areas) : null;
        const max = areas.length ? Math.max(...areas) : null;
        const primero = miembros[0];

        const code = suelo ? `L${++numeroSuelo}` : letraDe(letra++);
        const nombre = suelo
          ? `${primero.tipo} ${etiquetaTramo(min, max)}`
          : `Tipo ${code} · ${describir(primero.bedrooms, min, max)}`;

        const [tipologia] = (await q.query(
          `INSERT INTO "unit_type"
             ("family_id", "code", "name", "kind", "bedrooms", "bathrooms",
              "garages", "area_min", "area_max", "built_area", "position")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            familia.id,
            code,
            nombre.slice(0, 160),
            suelo ? 'AUTO' : 'FIXED',
            suelo ? null : primero.bedrooms,
            suelo ? null : primero.bathrooms,
            suelo ? null : primero.garages,
            min,
            max,
            suelo ? null : primero.built,
            posicion++,
          ],
        )) as { id: string }[];

        await q.query(
          `UPDATE "property" SET "unit_type_id" = $1 WHERE id = ANY($2::uuid[])`,
          [tipologia.id, miembros.map((m) => m.id)],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "property" ADD COLUMN "unit_type" varchar(80)`);
    await q.query(`ALTER TABLE "property" DROP COLUMN IF EXISTS "unit_type_id"`);
    await q.query(`DROP TABLE IF EXISTS "unit_type"`);
    await q.query(`DROP TYPE IF EXISTS "unit_type_kind_enum"`);
    // Los proyectos deducidos se quedan: borrarlos se llevaria por delante
    // cualquier cosa que la agencia haya escrito en ellos mientras tanto.
  }
}

interface Unidad {
  id: string;
  property_type_id: number;
  tipo: string;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  area: number | null;
  built: number | null;
}

/** Suelo: lo que se vende por metros y no por habitaciones. */
function esSuelo(tipo: string): boolean {
  return /lote|terreno|finca|isla|chacra|campos/i.test(tipo);
}

/**
 * Las unidades que un comprador vería como la misma.
 *
 * Se parte por lo que no admite discusion —tipo de inmueble, y alcobas y baños
 * si es habitable— y dentro de cada parte se agrupan las areas CERCANAS, no
 * las iguales: en "Calle 35 #24-24" hay apartamentos de 73, 75 y 85 m² con las
 * mismas alcobas, y 73 y 75 son el mismo apartamento medido dos veces, 85 no.
 * Redondear no vale, porque cualquier redondeo tiene un borde y 73 y 75 caen a
 * cada lado del suyo. Se compara con el menor del grupo y se abre uno nuevo al
 * separarse mas de la tolerancia.
 *
 * El suelo va mas suelto —40%— porque se vende por magnitud: un lote de 600 m²
 * y otro de 800 son lo mismo para quien busca, y 1.400 ya es otra cosa.
 */
function agrupar(unidades: Unidad[]): Unidad[][] {
  const partes = new Map<string, Unidad[]>();
  for (const unidad of unidades) {
    const clave = esSuelo(unidad.tipo)
      ? `S|${unidad.property_type_id}`
      : `H|${unidad.property_type_id}|${unidad.bedrooms ?? 0}|${unidad.bathrooms ?? 0}`;
    partes.set(clave, [...(partes.get(clave) ?? []), unidad]);
  }

  const grupos: Unidad[][] = [];
  for (const [clave, miembros] of partes) {
    const tolerancia = clave.startsWith('S') ? 0.4 : 0.1;
    const conArea = miembros
      .filter((m) => typeof m.area === 'number' && m.area > 0)
      .sort((a, b) => (a.area ?? 0) - (b.area ?? 0));
    const sinArea = miembros.filter(
      (m) => !(typeof m.area === 'number' && m.area > 0),
    );

    let actual: Unidad[] = [];
    for (const unidad of conArea) {
      const menor = actual[0]?.area ?? 0;
      if (actual.length && (unidad.area as number) > menor * (1 + tolerancia)) {
        grupos.push(actual);
        actual = [];
      }
      actual.push(unidad);
    }
    if (actual.length) grupos.push(actual);
    // Las que no tienen area no se pueden comparar: van juntas y aparte.
    if (sinArea.length) grupos.push(sinArea);
  }

  // Primero las que mas unidades tienen: es el orden en que la agencia las
  // enseña y el que hace que A sea la tipologia principal del proyecto.
  return grupos.sort((a, b) => b.length - a.length || (a[0].area ?? 0) - (b[0].area ?? 0));
}

function etiquetaTramo(min: number | null, max: number | null): string {
  if (!min) return 'sin área';
  const desde = Math.round(min);
  const hasta = max ? Math.round(max) : desde;
  return desde === hasta ? `${desde} m²` : `${desde} – ${hasta} m²`;
}

function describir(
  bedrooms: number | null,
  min: number | null,
  max: number | null,
): string {
  const partes: string[] = [];
  if (bedrooms)
    partes.push(`${bedrooms} ${bedrooms === 1 ? 'alcoba' : 'alcobas'}`);
  if (min) partes.push(etiquetaTramo(min, max));
  return partes.join(' · ') || 'sin datos';
}

/** A, B, C… y AA, AB… si un proyecto tuviera mas de veintiseis. */
function letraDe(indice: number): string {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (indice < 26) return letras[indice];
  return letras[Math.floor(indice / 26) - 1] + letras[indice % 26];
}
