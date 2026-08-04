import { MigrationInterface, QueryRunner } from "typeorm";

export class HomeShowcase1785875352308 implements MigrationInterface {
    name = 'HomeShowcase1785875352308'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."home_settings_source_enum" AS ENUM('RECENT', 'OUTSTANDING', 'MANUAL')`);
        await queryRunner.query(`CREATE TYPE "public"."home_settings_effect_enum" AS ENUM('SLIDE', 'FADE')`);
        await queryRunner.query(`CREATE TABLE "home_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "source" "public"."home_settings_source_enum" NOT NULL DEFAULT 'RECENT', "codes" jsonb NOT NULL DEFAULT '[]', "count" integer NOT NULL DEFAULT '9', "autoplay" boolean NOT NULL DEFAULT true, "delay_ms" integer NOT NULL DEFAULT '5000', "effect" "public"."home_settings_effect_enum" NOT NULL DEFAULT 'SLIDE', CONSTRAINT "pk_home_settings_id" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "home_settings"`);
        await queryRunner.query(`DROP TYPE "public"."home_settings_effect_enum"`);
        await queryRunner.query(`DROP TYPE "public"."home_settings_source_enum"`);
    }

}
