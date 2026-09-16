import { MigrationInterface, QueryRunner } from 'typeorm';

export class PropertyChangeRequests1787800000000 implements MigrationInterface {
  name = 'PropertyChangeRequests1787800000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "property_change_request_action_enum" AS ENUM('UPDATE','ARCHIVE')`);
    await q.query(`CREATE TYPE "property_change_request_status_enum" AS ENUM('PENDING','APPROVED','APPLIED','REJECTED')`);
    await q.query(`CREATE TABLE "property_change_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "deleted_at" timestamptz, "property_id" uuid NOT NULL, "client_id" uuid NOT NULL, "action" "property_change_request_action_enum" NOT NULL, "status" "property_change_request_status_enum" NOT NULL DEFAULT 'PENDING', "before_values" jsonb NOT NULL, "after_values" jsonb NOT NULL, "reviewed_by_agent_id" uuid, "reviewed_at" timestamptz, "apply_after" timestamptz, "applied_at" timestamptz, "resolution" text, CONSTRAINT "pk_property_change_request" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "idx_property_change_status_apply" ON "property_change_request" ("status","apply_after")`);
    await q.query(`CREATE INDEX "idx_property_change_client_created" ON "property_change_request" ("client_id","created_at")`);
    await q.query(`CREATE TABLE "portal_change_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "deleted_at" timestamptz, "propagation_minutes" integer NOT NULL DEFAULT 5, CONSTRAINT "pk_portal_change_settings" PRIMARY KEY ("id"))`);
    await q.query(`INSERT INTO "portal_change_settings" ("propagation_minutes") VALUES (5)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "portal_change_settings"`);
    await q.query(`DROP TABLE "property_change_request"`);
    await q.query(`DROP TYPE "property_change_request_status_enum"`);
    await q.query(`DROP TYPE "property_change_request_action_enum"`);
  }
}
