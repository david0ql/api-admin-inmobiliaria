import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multisede.
 *
 * Todo lo que existe hoy es de una sola oficina, la de Bucaramanga, pero nada
 * lo dice: la migracion crea esa sede, la marca como la de por defecto y le
 * cuelga los 642 inmuebles, los clientes, los proyectos, las solicitudes y el
 * equipo. Sin ese relleno, al activar el filtro por sede el panel se quedaria
 * vacio de golpe.
 *
 * Las columnas nacen NULL y se rellenan antes de ponerles NOT NULL: hacerlo al
 * reves falla en cuanto hay una fila.
 */
export class Branches1786100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "branch" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "name" varchar(120) NOT NULL,
        "code" varchar(12) NOT NULL,
        "city_id" int,
        "address" varchar(200),
        "phone" varchar(40),
        "is_default" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_branch_name" UNIQUE ("name"),
        CONSTRAINT "UQ_branch_code" UNIQUE ("code")
      )`);

    /*
      La sede de siempre. La ciudad y la direccion salen de los datos que ya
      hay: la oficina esta en Bucaramanga y su direccion es la que la web lleva
      publicando desde el principio.
    */
    await q.query(`
      INSERT INTO "branch" ("name", "code", "city_id", "address", "phone", "is_default")
      VALUES (
        'Bucaramanga',
        'BGA',
        (SELECT id FROM city WHERE lower(name) = 'bucaramanga' LIMIT 1),
        'Carrera 29 #45-45',
        '+573222023280',
        true
      )`);

    const [sede] = (await q.query(
      `SELECT id FROM "branch" WHERE is_default = true LIMIT 1`,
    )) as { id: string }[];

    // El rol nuevo tiene que existir antes de que nadie lo lleve.
    for (const rol of ['DIRECTOR', 'COORDINATOR']) {
      await q.query(
        `ALTER TYPE "agent_role_enum" ADD VALUE IF NOT EXISTS '${rol}'`,
      );
    }

    const tablas = [
      'agent',
      'property',
      'client',
      'property_family',
      'consignment_request',
      'credit_request',
      'appointment',
    ];

    for (const tabla of tablas) {
      const existe = (await q.query(
        `SELECT to_regclass('public.${tabla}') AS t`,
      )) as { t: string | null }[];
      if (!existe[0]?.t) continue;

      await q.query(`ALTER TABLE "${tabla}" ADD COLUMN "branch_id" uuid`);
      await q.query(`UPDATE "${tabla}" SET "branch_id" = $1`, [sede.id]);
      await q.query(
        `ALTER TABLE "${tabla}" ADD CONSTRAINT "FK_${tabla}_branch"
         FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT`,
      );
      await q.query(
        `CREATE INDEX "IDX_${tabla}_branch" ON "${tabla}" ("branch_id")`,
      );
    }

    /*
      El inventario y las personas SIEMPRE tienen sede: un inmueble sin oficina
      que lo lleve no lo ve nadie, y es justo el agujero por donde se cuelan las
      filas invisibles. El agente la deja opcional porque quien ve todas las
      sedes no pertenece a ninguna.
    */
    for (const tabla of ['property', 'client', 'property_family']) {
      await q.query(
        `ALTER TABLE "${tabla}" ALTER COLUMN "branch_id" SET NOT NULL`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of [
      'agent',
      'property',
      'client',
      'property_family',
      'consignment_request',
      'credit_request',
      'appointment',
    ]) {
      await q.query(
        `ALTER TABLE "${tabla}" DROP COLUMN IF EXISTS "branch_id"`,
      );
    }
    await q.query(`DROP TABLE IF EXISTS "branch"`);
  }
}
