import { MigrationInterface, QueryRunner } from 'typeorm';

export class FamiliesAndPublic1785622664914 implements MigrationInterface {
  name = 'FamiliesAndPublic1785622664914';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."property_family_kind_enum" AS ENUM('PROJECT', 'COMPLEX', 'BUILDING', 'STAGE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_family_status_enum" AS ENUM('PLANNED', 'UNDER_CONSTRUCTION', 'DELIVERED', 'SOLD_OUT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "property_family" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "name" character varying(200) NOT NULL, "slug" character varying(220) NOT NULL, "kind" "public"."property_family_kind_enum" NOT NULL DEFAULT 'COMPLEX', "status" "public"."property_family_status_enum" NOT NULL DEFAULT 'DELIVERED', "description" text, "developer" character varying(200), "city_id" integer, "zone_id" integer, "address" character varying(300), "latitude" numeric(10,7), "longitude" numeric(10,7), "delivery_year" smallint, "total_units" smallint, "cover_url" text, "published" boolean NOT NULL DEFAULT true, "parent_id" uuid, CONSTRAINT "pk_property_family_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_family_name" ON "property_family"  ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_family_slug" ON "property_family"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_family_parent_id" ON "property_family"  ("parent_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_family_city_id_status" ON "property_family"  ("city_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consignment_request_status_enum" AS ENUM('NEW', 'REVIEWING', 'VISIT_SCHEDULED', 'ACCEPTED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consignment_request_view_enum" AS ENUM('NORTH', 'SOUTH', 'EAST', 'WEST')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consignment_request_condition_enum" AS ENUM('ORIGINAL', 'TO_REMODEL', 'REMODELED', 'BRAND_NEW', 'SHELL', 'BLUEPRINT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consignment_request_credit_type_enum" AS ENUM('MORTGAGE', 'LEASING', 'DEBT_FREE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consignment_request_occupancy_enum" AS ENUM('RENTED', 'VACANT', 'OWNER_OCCUPIED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "consignment_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "reference" character varying(20) NOT NULL, "status" "public"."consignment_request_status_enum" NOT NULL DEFAULT 'NEW', "city_id" integer, "city_name" character varying(160) NOT NULL, "commune" character varying(120), "neighborhood" character varying(160) NOT NULL, "complex_name" character varying(200) NOT NULL, "address" character varying(300) NOT NULL, "unit_number" character varying(60) NOT NULL, "stratum" smallint NOT NULL, "property_type_id" integer, "property_type_name" character varying(80) NOT NULL, "floor" character varying(40), "view" "public"."consignment_request_view_enum", "has_elevator" boolean NOT NULL DEFAULT false, "condition" "public"."consignment_request_condition_enum" NOT NULL, "private_area" numeric(12,2), "built_area" numeric(12,2) NOT NULL, "lot_area" numeric(12,2), "bedrooms" smallint NOT NULL, "bathrooms" smallint NOT NULL, "parking_spaces" smallint NOT NULL, "has_storage_room" boolean NOT NULL DEFAULT false, "building_year" smallint NOT NULL, "amenity_ids" integer array NOT NULL DEFAULT '{}', "amenities_other" character varying(300), "maintenance_fee" numeric(16,2) NOT NULL DEFAULT '0', "sale_price" numeric(16,2) NOT NULL, "credit_type" "public"."consignment_request_credit_type_enum" NOT NULL, "credit_institution" character varying(160), "debt_amount" numeric(16,2), "occupancy" "public"."consignment_request_occupancy_enum" NOT NULL, "rent_amount" numeric(16,2), "lease_ends_on" date, "owner_first_name" character varying(160) NOT NULL, "owner_last_name" character varying(160) NOT NULL, "owner_email" character varying(180) NOT NULL, "owner_phone" character varying(40) NOT NULL, "notes" text, "files" jsonb NOT NULL DEFAULT '[]'::jsonb, "requested_visit_at" TIMESTAMP WITH TIME ZONE, "appointment_id" uuid, "property_id" uuid, "client_id" uuid, "reviewed_by_agent_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "resolution" character varying(500), "submitted_from_ip" character varying(64), CONSTRAINT "pk_consignment_request_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_consignment_request_reference" ON "consignment_request"  ("reference") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_consignment_request_owner_email" ON "consignment_request"  ("owner_email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_consignment_request_owner_phone" ON "consignment_request"  ("owner_phone") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_consignment_request_status_created_at" ON "consignment_request"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "property_family_closure" ("id_ancestor" uuid NOT NULL, "id_descendant" uuid NOT NULL, CONSTRAINT "pk_property_family_closure_id_ancestor_id_descendant" PRIMARY KEY ("id_ancestor", "id_descendant"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_family_closure_id_ancestor" ON "property_family_closure"  ("id_ancestor") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_family_closure_id_descendant" ON "property_family_closure"  ("id_descendant") `,
    );
    await queryRunner.query(`ALTER TABLE "property" ADD "family_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "property" ADD "unit_type" character varying(120)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_family_id" ON "property"  ("family_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" ADD CONSTRAINT "fk_property_family_city_id" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" ADD CONSTRAINT "fk_property_family_zone_id" FOREIGN KEY ("zone_id") REFERENCES "zone"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" ADD CONSTRAINT "fk_property_family_parent_id" FOREIGN KEY ("parent_id") REFERENCES "property_family"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_family_id" FOREIGN KEY ("family_id") REFERENCES "property_family"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family_closure" ADD CONSTRAINT "fk_property_family_closure_id_ancestor" FOREIGN KEY ("id_ancestor") REFERENCES "property_family"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family_closure" ADD CONSTRAINT "fk_property_family_closure_id_descendant" FOREIGN KEY ("id_descendant") REFERENCES "property_family"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "property_family_closure" DROP CONSTRAINT "fk_property_family_closure_id_descendant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family_closure" DROP CONSTRAINT "fk_property_family_closure_id_ancestor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_family_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" DROP CONSTRAINT "fk_property_family_parent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" DROP CONSTRAINT "fk_property_family_zone_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_family" DROP CONSTRAINT "fk_property_family_city_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_property_family_id"`);
    await queryRunner.query(`ALTER TABLE "property" DROP COLUMN "unit_type"`);
    await queryRunner.query(`ALTER TABLE "property" DROP COLUMN "family_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_family_closure_id_descendant"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_family_closure_id_ancestor"`,
    );
    await queryRunner.query(`DROP TABLE "property_family_closure"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_consignment_request_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_consignment_request_owner_phone"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_consignment_request_owner_email"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_consignment_request_reference"`,
    );
    await queryRunner.query(`DROP TABLE "consignment_request"`);
    await queryRunner.query(
      `DROP TYPE "public"."consignment_request_occupancy_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."consignment_request_credit_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."consignment_request_condition_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."consignment_request_view_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."consignment_request_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_family_city_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_family_parent_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_property_family_slug"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_family_name"`);
    await queryRunner.query(`DROP TABLE "property_family"`);
    await queryRunner.query(`DROP TYPE "public"."property_family_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."property_family_kind_enum"`);
  }
}
