import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inactivar un inmueble desde el portal pasa a ser una solicitud como las
 * demas, asi que el enum de acciones necesita el valor nuevo.
 *
 * Se cambia el tipo entero en vez de usar `ALTER TYPE ... ADD VALUE`: Postgres
 * no deja usar un valor añadido hasta que termina la transaccion que lo añadio,
 * y TypeORM corre todas las migraciones dentro de una sola.
 */
export class DeactivateChangeRequest1788000000000 implements MigrationInterface {
  name = 'DeactivateChangeRequest1788000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE "property_change_request_action_enum" RENAME TO "property_change_request_action_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "property_change_request_action_enum" AS ENUM('UPDATE','DEACTIVATE','ARCHIVE')`,
    );
    await q.query(
      `ALTER TABLE "property_change_request" ALTER COLUMN "action" TYPE "property_change_request_action_enum" USING "action"::text::"property_change_request_action_enum"`,
    );
    await q.query(`DROP TYPE "property_change_request_action_enum_old"`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Una solicitud de inactivacion no cabe en el tipo viejo: se descarta.
    await q.query(
      `DELETE FROM "property_change_request" WHERE "action" = 'DEACTIVATE'`,
    );
    await q.query(
      `ALTER TYPE "property_change_request_action_enum" RENAME TO "property_change_request_action_enum_new"`,
    );
    await q.query(
      `CREATE TYPE "property_change_request_action_enum" AS ENUM('UPDATE','ARCHIVE')`,
    );
    await q.query(
      `ALTER TABLE "property_change_request" ALTER COLUMN "action" TYPE "property_change_request_action_enum" USING "action"::text::"property_change_request_action_enum"`,
    );
    await q.query(`DROP TYPE "property_change_request_action_enum_new"`);
  }
}
