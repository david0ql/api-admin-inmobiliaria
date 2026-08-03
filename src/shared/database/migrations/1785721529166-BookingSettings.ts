import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingSettings1785721529166 implements MigrationInterface {
  name = 'BookingSettings1785721529166';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."booking_settings_lead_mode_enum" AS ENUM('UNIFORM', 'BY_AVAILABILITY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "booking_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workdays" jsonb NOT NULL DEFAULT '[]', "lead_mode" "public"."booking_settings_lead_mode_enum" NOT NULL DEFAULT 'UNIFORM', "uniform_lead_hours" integer NOT NULL DEFAULT '24', "lead_days_by_availability" jsonb NOT NULL DEFAULT '{}', "lead_days_by_operation" jsonb NOT NULL DEFAULT '{}', "suggested_slots" integer NOT NULL DEFAULT '3', "slot_minutes" integer NOT NULL DEFAULT '60', CONSTRAINT "pk_booking_settings_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "booking_settings"`);
    await queryRunner.query(
      `DROP TYPE "public"."booking_settings_lead_mode_enum"`,
    );
  }
}
