import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sincronizacion propia con los portales.
 *
 * Crea la tabla de conexiones (una por portal que sabemos hablar) y convierte
 * cada `property_publication` en su propia cola de envios. Las conexiones
 * nacen APAGADAS: hasta que alguien mete credenciales y las prueba, nada sale
 * hacia ningun portal, y WASI sigue siendo quien publica.
 *
 * Los ids de portal son los de WASI, que es de donde viene el catalogo.
 */
export class PortalSync1787900000000 implements MigrationInterface {
  name = 'PortalSync1787900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE "property_publication_state_enum" ADD VALUE IF NOT EXISTS 'REMOVED'`,
    );
    await q.query(
      `CREATE TYPE "publication_sync_action_enum" AS ENUM('UPSERT','REMOVE')`,
    );
    await q.query(`ALTER TABLE "property_publication"
      ADD "external_id" character varying(120),
      ADD "pending_action" "publication_sync_action_enum",
      ADD "next_attempt_at" timestamptz,
      ADD "attempts" integer NOT NULL DEFAULT 0,
      ADD "transaction_id" character varying(120),
      ADD "last_synced_at" timestamptz,
      ADD "last_error" text,
      ADD "synced_hash" character varying(64)`);
    // La cola se lee por aqui: lo pendiente y vencido, en orden.
    await q.query(
      `CREATE INDEX "idx_publication_queue" ON "property_publication" ("next_attempt_at") WHERE "pending_action" IS NOT NULL`,
    );

    await q.query(`CREATE TABLE "portal_connection" (
      "portal_id" integer NOT NULL,
      "connector" character varying(32) NOT NULL,
      "enabled" boolean NOT NULL DEFAULT false,
      "auto_publish_new" boolean NOT NULL DEFAULT true,
      "sandbox" boolean NOT NULL DEFAULT false,
      "credentials_enc" text,
      "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "inbound_token" character varying(64) NOT NULL,
      "last_check_at" timestamptz,
      "last_check_ok" boolean,
      "last_check_message" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "pk_portal_connection" PRIMARY KEY ("portal_id"),
      CONSTRAINT "fk_portal_connection_portal" FOREIGN KEY ("portal_id") REFERENCES "portal"("id") ON DELETE CASCADE
    )`);

    await q.query(`CREATE TABLE "portal_location" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "portal_id" integer NOT NULL,
      "city_id" integer NOT NULL,
      "zone_id" integer,
      "zone_key" integer GENERATED ALWAYS AS (coalesce(zone_id, 0)) STORED,
      "external_id" character varying(120) NOT NULL,
      "external_name" character varying(300) NOT NULL,
      "extra" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "verified" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "pk_portal_location" PRIMARY KEY ("id"),
      CONSTRAINT "fk_portal_location_portal" FOREIGN KEY ("portal_id") REFERENCES "portal"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_portal_location_city" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_portal_location_zone" FOREIGN KEY ("zone_id") REFERENCES "zone"("id") ON DELETE CASCADE
    )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_portal_location" ON "portal_location" ("portal_id", "city_id", "zone_key")`,
    );

    // Los que WASI tiene conectados hoy y tienen via propia. Fuera quedan Los
    // Compradores (es de WASI: sin WASI no hay forma de publicar alli) y
    // Anuto (solo tiene conector para WASI; se publica a mano). Doomos, Luxury
    // Estate y Arriendo.com no publican feed abierto: se les ofrece el nuestro
    // en formato Trovit. Clasf tiene formato propio. Solo si el portal existe
    // en el catalogo de esta base.
    await q.query(`
      INSERT INTO "portal_connection" ("portal_id", "connector", "settings", "inbound_token")
      SELECT p.id, c.connector, c.settings::jsonb,
             replace(uuid_generate_v4()::text, '-', '') || replace(uuid_generate_v4()::text, '-', '')
      FROM (VALUES
        (16, 'fincaraiz', '{}'),
        (45, 'metrocuadrado', '{}'),
        (30, 'proppit', '{}'),
        (72, 'meta', '{}'),
        (12, 'feed', '{"format":"clasf"}'),
        (8, 'feed', '{"format":"trovit"}'),
        (36, 'feed', '{"format":"trovit"}'),
        (105, 'feed', '{"format":"trovit"}')
      ) AS c(id, connector, settings)
      JOIN "portal" p ON p.id = c.id
      ON CONFLICT DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "portal_location"`);
    await q.query(`DROP TABLE "portal_connection"`);
    await q.query(`DROP INDEX "idx_publication_queue"`);
    await q.query(`ALTER TABLE "property_publication"
      DROP COLUMN "synced_hash",
      DROP COLUMN "last_error",
      DROP COLUMN "last_synced_at",
      DROP COLUMN "transaction_id",
      DROP COLUMN "attempts",
      DROP COLUMN "next_attempt_at",
      DROP COLUMN "pending_action",
      DROP COLUMN "external_id"`);
    await q.query(`DROP TYPE "publication_sync_action_enum"`);
    // Postgres no sabe quitar un valor de un enum; 'REMOVED' se queda.
    await q.query(
      `UPDATE "property_publication" SET "state" = 'PAUSED' WHERE "state" = 'REMOVED'`,
    );
  }
}
