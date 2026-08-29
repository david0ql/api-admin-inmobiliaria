import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Control de asistencia: una tabla de marcas.
 *
 * Cada fila es un hecho —"entré" o "me voy"— con su instante, sus coordenadas
 * y la direccion legible que se resolvio en ese momento. La jornada no se
 * guarda: se calcula emparejando marcas al leer (ver `AttendanceMark`).
 *
 * Los dos indices son los dos accesos que existen: el panel de administracion
 * filtra por persona y fecha, y tambien por sede cuando quien mira es un
 * coordinador. Sin ellos, la pantalla de historia recorreria la tabla entera
 * cada vez que alguien cambia el mes.
 */
export class Attendance1786400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TYPE "attendance_mark_type_enum" AS ENUM ('IN', 'OUT')`);

    await q.query(`
      CREATE TABLE "attendance_mark" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "type" "attendance_mark_type_enum" NOT NULL,
        "happened_at" timestamptz NOT NULL,
        "agent_id" uuid NOT NULL REFERENCES "agent"("id") ON DELETE CASCADE,
        "branch_id" uuid REFERENCES "branch"("id") ON DELETE SET NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "accuracy_m" int,
        "address" varchar(300),
        CONSTRAINT "CHK_attendance_mark_latitude" CHECK ("latitude" BETWEEN -90 AND 90),
        CONSTRAINT "CHK_attendance_mark_longitude" CHECK ("longitude" BETWEEN -180 AND 180)
      )`);

    await q.query(`
      CREATE INDEX "IDX_attendance_mark_agent_time"
        ON "attendance_mark" ("agent_id", "happened_at")`);
    await q.query(`
      CREATE INDEX "IDX_attendance_mark_branch_time"
        ON "attendance_mark" ("branch_id", "happened_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "attendance_mark"`);
    await q.query(`DROP TYPE IF EXISTS "attendance_mark_type_enum"`);
  }
}
