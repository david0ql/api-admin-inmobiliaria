import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los embudos dejan de ser de la empresa entera.
 *
 * Hasta ahora cualquiera con acceso al tablero veia los tres embudos, fueran
 * suyos o no: un asesor de una sede abria el embudo de captacion de otra. Se
 * añaden dos cosas:
 *
 *  - `branch_id`: de que sede es el embudo. En blanco significa "de toda la
 *    empresa", que es lo que son los tres que ya existen y lo unico que puede
 *    crear la administracion.
 *  - `visible_roles`: que perfiles lo ven. Lista vacia significa "todos", para
 *    que los embudos de siempre sigan comportandose igual.
 *
 * Nada se recorta al migrar: lo que habia queda global y visible para todos, y
 * a partir de ahi se acota a mano.
 */
export class PipelineScope1788100000000 implements MigrationInterface {
  name = 'PipelineScope1788100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "pipeline" ADD COLUMN "branch_id" uuid NULL REFERENCES "branch"("id") ON DELETE SET NULL`,
    );
    await q.query(
      `ALTER TABLE "pipeline" ADD COLUMN "visible_roles" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await q.query(
      `CREATE INDEX "idx_pipeline_branch" ON "pipeline" ("branch_id")`,
    );
    /*
      El nombre era unico en toda la base, y con embudos por sede eso deja de
      valer: dos oficinas pueden tener cada una su "Captacion". Pasa a ser unico
      por sede, y los globales entre si.
    */
    await q.query(`DROP INDEX IF EXISTS "IDX_pipeline_name"`);
    await q.query(
      `ALTER TABLE "pipeline" DROP CONSTRAINT IF EXISTS "UQ_pipeline_name"`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_pipeline_nombre_sede" ON "pipeline" ("name", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid))`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_pipeline_nombre_sede"`);
    await q.query(`DROP INDEX IF EXISTS "idx_pipeline_branch"`);
    await q.query(`ALTER TABLE "pipeline" DROP COLUMN "visible_roles"`);
    await q.query(`ALTER TABLE "pipeline" DROP COLUMN "branch_id"`);
    await q.query(
      `CREATE UNIQUE INDEX "IDX_pipeline_name" ON "pipeline" ("name")`,
    );
  }
}
