import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1785617967501 implements MigrationInterface {
  name = 'InitialSchema1785617967501';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."activity_type_enum" AS ENUM('NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'OFFER', 'STAGE_CHANGE', 'ASSIGNMENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "activity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "type" "public"."activity_type_enum" NOT NULL, "client_id" uuid, "property_id" uuid, "agent_id" uuid, "summary" character varying(300) NOT NULL, "detail" text, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "automatic" boolean NOT NULL DEFAULT false, CONSTRAINT "pk_activity_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_type" ON "activity"  ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_agent_id" ON "activity"  ("agent_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_occurred_at" ON "activity"  ("occurred_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_property_id_occurred_at" ON "activity"  ("property_id", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_client_id_occurred_at" ON "activity"  ("client_id", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "property_type" ("id" integer NOT NULL, "name" character varying(120) NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "pk_property_type_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."feature_scope_enum" AS ENUM('INTERNAL', 'EXTERNAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "feature" ("id" integer NOT NULL, "name" character varying(160) NOT NULL, "scope" "public"."feature_scope_enum" NOT NULL, CONSTRAINT "pk_feature_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_feature_scope" ON "feature"  ("scope") `,
    );
    await queryRunner.query(
      `CREATE TABLE "currency" ("id" integer NOT NULL, "iso" character varying(8) NOT NULL, "name" character varying(80) NOT NULL, CONSTRAINT "pk_currency_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "client_type" ("id" integer NOT NULL, "name" character varying(80) NOT NULL, CONSTRAINT "pk_client_type_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "portal" ("id" integer NOT NULL, "name" character varying(160) NOT NULL, "paid" boolean NOT NULL DEFAULT false, "connected" boolean NOT NULL DEFAULT false, CONSTRAINT "pk_portal_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "country" ("id" integer NOT NULL, "name" character varying(120) NOT NULL, "iso" character varying(8), CONSTRAINT "pk_country_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "region" ("id" integer NOT NULL, "name" character varying(160) NOT NULL, "country_id" integer NOT NULL, CONSTRAINT "pk_region_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_region_country_id" ON "region"  ("country_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "city" ("id" integer NOT NULL, "name" character varying(160) NOT NULL, "region_id" integer NOT NULL, CONSTRAINT "pk_city_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_city_name" ON "city"  ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_city_region_id" ON "city"  ("region_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "zone" ("id" integer NOT NULL, "name" character varying(200) NOT NULL, "city_id" integer NOT NULL, CONSTRAINT "pk_zone_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_zone_name" ON "zone"  ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_zone_city_id" ON "zone"  ("city_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_shift_kind_enum" AS ENUM('OFFICE', 'ON_CALL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_shift" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "agent_id" uuid NOT NULL, "weekday" smallint NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, "kind" "public"."agent_shift_kind_enum" NOT NULL DEFAULT 'OFFICE', "valid_from" date, "valid_until" date, CONSTRAINT "pk_agent_shift_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_shift_agent_id_weekday" ON "agent_shift"  ("agent_id", "weekday") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_role_enum" AS ENUM('ADMIN', 'MANAGER', 'AGENT', 'VIEWER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agent" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "first_name" character varying(120) NOT NULL, "last_name" character varying(120), "email" character varying(180) NOT NULL, "password_hash" character varying(255), "must_set_password" boolean NOT NULL DEFAULT true, "cell_phone" character varying(32), "has_whatsapp" boolean NOT NULL DEFAULT false, "photo_url" text, "role" "public"."agent_role_enum" NOT NULL DEFAULT 'AGENT', "status" "public"."agent_status_enum" NOT NULL DEFAULT 'ACTIVE', "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "pk_agent_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agent_wasi_id" ON "agent"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agent_email" ON "agent"  ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_status" ON "agent"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pipeline" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "name" character varying(120) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "position" smallint NOT NULL DEFAULT '0', CONSTRAINT "pk_pipeline_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_pipeline_wasi_id" ON "pipeline"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_pipeline_name" ON "pipeline"  ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pipeline_stage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "pipeline_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "position" smallint NOT NULL DEFAULT '0', "color" character varying(9) NOT NULL DEFAULT '#6b7280', "is_won" boolean NOT NULL DEFAULT false, "is_lost" boolean NOT NULL DEFAULT false, CONSTRAINT "uq_stage_pipeline_name" UNIQUE ("pipeline_id", "name"), CONSTRAINT "pk_pipeline_stage_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_pipeline_stage_wasi_id" ON "pipeline_stage"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pipeline_stage_pipeline_id" ON "pipeline_stage"  ("pipeline_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "lead_source" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "name" character varying(120) NOT NULL, "aliases" text array NOT NULL DEFAULT '{}', "paid" boolean NOT NULL DEFAULT false, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "pk_lead_source_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_lead_source_name" ON "lead_source"  ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "property_image" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "property_id" uuid NOT NULL, "wasi_id" integer, "storage_key" character varying(300) NOT NULL, "url" text NOT NULL, "url_large" text NOT NULL, "url_original" text NOT NULL, "source_url" text, "checksum" character varying(64), "width" integer, "height" integer, "bytes" integer, "description" character varying(300), "position" smallint NOT NULL DEFAULT '1', "is_main" boolean NOT NULL DEFAULT false, CONSTRAINT "pk_property_image_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_image_checksum" ON "property_image"  ("checksum") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_image_property_id_position" ON "property_image"  ("property_id", "position") `,
    );
    await queryRunner.query(
      `CREATE TABLE "property_label" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "name" character varying(80) NOT NULL, "color" character varying(9) NOT NULL DEFAULT '#6b7280', CONSTRAINT "pk_property_label_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_label_wasi_id" ON "property_label"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_label_name" ON "property_label"  ("name") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_rent_period_enum" AS ENUM('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'ANNUAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_map_publication_enum" AS ENUM('HIDDEN', 'APPROXIMATE', 'EXACT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_condition_enum" AS ENUM('NEW', 'USED', 'PROJECT', 'UNDER_CONSTRUCTION')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_availability_enum" AS ENUM('AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'WITHDRAWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_publication_status_enum" AS ENUM('DRAFT', 'ACTIVE', 'OUTSTANDING', 'INACTIVE')`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'serrano',
        'public',
        'property',
        'GENERATED_COLUMN',
        'search_text',
        "lower(coalesce(title,'') || ' ' || coalesce(address,'') || ' ' || coalesce(code,''))",
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "property" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "code" character varying(32) NOT NULL, "title" character varying(300) NOT NULL, "address" character varying(300), "public_url" text, "for_sale" boolean NOT NULL DEFAULT false, "for_rent" boolean NOT NULL DEFAULT false, "for_transfer" boolean NOT NULL DEFAULT false, "for_temporary_rent" boolean NOT NULL DEFAULT false, "sale_price" numeric(16,2), "rent_price" numeric(16,2), "maintenance_fee" numeric(16,2), "rent_period" "public"."property_rent_period_enum", "currency_id" integer NOT NULL, "property_type_id" integer NOT NULL, "city_id" integer NOT NULL, "zone_id" integer, "latitude" numeric(10,7), "longitude" numeric(10,7), "map_publication" "public"."property_map_publication_enum" NOT NULL DEFAULT 'APPROXIMATE', "area" numeric(12,2), "built_area" numeric(12,2), "private_area" numeric(12,2), "bedrooms" smallint, "bathrooms" smallint, "garages" smallint, "floor" smallint, "stratum" smallint, "condition" "public"."property_condition_enum", "building_year" smallint, "observations" text, "availability" "public"."property_availability_enum" NOT NULL DEFAULT 'AVAILABLE', "publication_status" "public"."property_publication_status_enum" NOT NULL DEFAULT 'DRAFT', "label_id" uuid, "visits" integer NOT NULL DEFAULT '0', "video_url" text, "tour_url" text, "wasi_gallery_id" integer, "assigned_agent_id" uuid, "search_text" text GENERATED ALWAYS AS (lower(coalesce(title,'') || ' ' || coalesce(address,'') || ' ' || coalesce(code,''))) STORED, CONSTRAINT "pk_property_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_wasi_id" ON "property"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_property_code" ON "property"  ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_for_sale" ON "property"  ("for_sale") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_for_rent" ON "property"  ("for_rent") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_property_type_id" ON "property"  ("property_type_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_assigned_agent_id" ON "property"  ("assigned_agent_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_latitude_longitude" ON "property"  ("latitude", "longitude") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_sale_price" ON "property"  ("sale_price") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_city_id_zone_id" ON "property"  ("city_id", "zone_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_availability_publication_status" ON "property"  ("availability", "publication_status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_interest_role_enum" AS ENUM('PROSPECT', 'BUYER', 'SELLER', 'OWNER', 'TENANT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_interest_status_enum" AS ENUM('OPEN', 'VISITED', 'OFFER_MADE', 'CLOSED_WON', 'CLOSED_LOST')`,
    );
    await queryRunner.query(
      `CREATE TABLE "property_interest" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "client_id" uuid NOT NULL, "property_id" uuid NOT NULL, "role" "public"."property_interest_role_enum" NOT NULL DEFAULT 'PROSPECT', "status" "public"."property_interest_status_enum" NOT NULL DEFAULT 'OPEN', "offered_amount" numeric(16,2), "notes" text, CONSTRAINT "uq_interest_client_property_role" UNIQUE ("client_id", "property_id", "role"), CONSTRAINT "pk_property_interest_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_interest_client_id" ON "property_interest"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_interest_property_id_status" ON "property_interest"  ("property_id", "status") `,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'serrano',
        'public',
        'client',
        'GENERATED_COLUMN',
        'search_text',
        "lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(cell_phone,'') || ' ' || coalesce(identification,''))",
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "client" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "wasi_id" integer, "first_name" character varying(160) NOT NULL, "last_name" character varying(160), "email" character varying(180), "cell_phone" character varying(40), "phone" character varying(40), "phone_normalized" character varying(20), "identification" character varying(40), "birthday" date, "pipeline_id" uuid NOT NULL, "stage_id" uuid NOT NULL, "stage_changed_at" TIMESTAMP WITH TIME ZONE, "source_id" uuid, "city_id" integer, "assigned_agent_id" uuid, "requirement" text, "notes" text, "accepts_marketing" boolean NOT NULL DEFAULT false, "last_contacted_at" TIMESTAMP WITH TIME ZONE, "search_text" text GENERATED ALWAYS AS (lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(cell_phone,'') || ' ' || coalesce(identification,''))) STORED, CONSTRAINT "pk_client_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_client_wasi_id" ON "client"  ("wasi_id") WHERE "wasi_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_phone_normalized" ON "client"  ("phone_normalized") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_source_id" ON "client"  ("source_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_assigned_agent_id" ON "client"  ("assigned_agent_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_last_contacted_at" ON "client"  ("last_contacted_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_assigned_agent_id_stage_id" ON "client"  ("assigned_agent_id", "stage_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_pipeline_id_stage_id" ON "client"  ("pipeline_id", "stage_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "agent_id" uuid NOT NULL, "token_hash" character varying(128) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "user_agent" character varying(255), "ip_address" character varying(64), CONSTRAINT "pk_refresh_token_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_token_agent_id" ON "refresh_token"  ("agent_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_refresh_token_token_hash" ON "refresh_token"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_assignment_role_enum" AS ENUM('CAPTURE', 'LISTING', 'SUPPORT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "property_assignment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "property_id" uuid NOT NULL, "agent_id" uuid NOT NULL, "role" "public"."property_assignment_role_enum" NOT NULL DEFAULT 'LISTING', "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "unassigned_at" TIMESTAMP WITH TIME ZONE, "reason" character varying(300), "assigned_by_agent_id" uuid, CONSTRAINT "pk_property_assignment_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_assignment_agent_id" ON "property_assignment"  ("agent_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_assignment_property_id_unassigned_at" ON "property_assignment"  ("property_id", "unassigned_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_type_enum" AS ENUM('VISIT', 'CALL', 'MEETING', 'SIGNING', 'PHOTO_SHOOT', 'APPRAISAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status_enum" AS ENUM('SCHEDULED', 'CONFIRMED', 'DONE', 'CANCELED', 'NO_SHOW')`,
    );
    await queryRunner.query(
      `CREATE TABLE "appointment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "type" "public"."appointment_type_enum" NOT NULL DEFAULT 'VISIT', "status" "public"."appointment_status_enum" NOT NULL DEFAULT 'SCHEDULED', "title" character varying(200) NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "agent_id" uuid NOT NULL, "client_id" uuid, "property_id" uuid, "location" character varying(300), "notes" text, "outcome" text, CONSTRAINT "pk_appointment_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_client_id" ON "appointment"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_property_id" ON "appointment"  ("property_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_starts_at_status" ON "appointment"  ("starts_at", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_agent_id_starts_at" ON "appointment"  ("agent_id", "starts_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."property_publication_state_enum" AS ENUM('PENDING', 'PUBLISHED', 'REJECTED', 'PAUSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "property_publication" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "property_id" uuid NOT NULL, "portal_id" integer NOT NULL, "state" "public"."property_publication_state_enum" NOT NULL DEFAULT 'PENDING', "published_at" TIMESTAMP WITH TIME ZONE, "note" character varying(300), "external_url" text, CONSTRAINT "uq_publication_property_portal" UNIQUE ("property_id", "portal_id"), CONSTRAINT "pk_property_publication_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_publication_portal_id_state" ON "property_publication"  ("portal_id", "state") `,
    );
    await queryRunner.query(
      `CREATE TABLE "property_feature" ("property_id" uuid NOT NULL, "feature_id" integer NOT NULL, CONSTRAINT "pk_property_feature_property_id_feature_id" PRIMARY KEY ("property_id", "feature_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_feature_property_id" ON "property_feature"  ("property_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_feature_feature_id" ON "property_feature"  ("feature_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "client_client_type" ("client_id" uuid NOT NULL, "client_type_id" integer NOT NULL, CONSTRAINT "pk_client_client_type_client_id_client_type_id" PRIMARY KEY ("client_id", "client_type_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_client_type_client_id" ON "client_client_type"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_client_type_client_type_id" ON "client_client_type"  ("client_type_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "region" ADD CONSTRAINT "fk_region_country_id" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "city" ADD CONSTRAINT "fk_city_region_id" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "zone" ADD CONSTRAINT "fk_zone_city_id" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_shift" ADD CONSTRAINT "fk_agent_shift_agent_id" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pipeline_stage" ADD CONSTRAINT "fk_pipeline_stage_pipeline_id" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_image" ADD CONSTRAINT "fk_property_image_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_currency_id" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_property_type_id" FOREIGN KEY ("property_type_id") REFERENCES "property_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_city_id" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_zone_id" FOREIGN KEY ("zone_id") REFERENCES "zone"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_label_id" FOREIGN KEY ("label_id") REFERENCES "property_label"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" ADD CONSTRAINT "fk_property_assigned_agent_id" FOREIGN KEY ("assigned_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_interest" ADD CONSTRAINT "fk_property_interest_client_id" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_interest" ADD CONSTRAINT "fk_property_interest_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD CONSTRAINT "fk_client_pipeline_id" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD CONSTRAINT "fk_client_stage_id" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stage"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD CONSTRAINT "fk_client_source_id" FOREIGN KEY ("source_id") REFERENCES "lead_source"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD CONSTRAINT "fk_client_city_id" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD CONSTRAINT "fk_client_assigned_agent_id" FOREIGN KEY ("assigned_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD CONSTRAINT "fk_refresh_token_agent_id" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_assignment" ADD CONSTRAINT "fk_property_assignment_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_assignment" ADD CONSTRAINT "fk_property_assignment_agent_id" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" ADD CONSTRAINT "fk_appointment_agent_id" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" ADD CONSTRAINT "fk_appointment_client_id" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" ADD CONSTRAINT "fk_appointment_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_publication" ADD CONSTRAINT "fk_property_publication_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_publication" ADD CONSTRAINT "fk_property_publication_portal_id" FOREIGN KEY ("portal_id") REFERENCES "portal"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_feature" ADD CONSTRAINT "fk_property_feature_property_id" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_feature" ADD CONSTRAINT "fk_property_feature_feature_id" FOREIGN KEY ("feature_id") REFERENCES "feature"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_client_type" ADD CONSTRAINT "fk_client_client_type_client_id" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_client_type" ADD CONSTRAINT "fk_client_client_type_client_type_id" FOREIGN KEY ("client_type_id") REFERENCES "client_type"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_client_type" DROP CONSTRAINT "fk_client_client_type_client_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_client_type" DROP CONSTRAINT "fk_client_client_type_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_feature" DROP CONSTRAINT "fk_property_feature_feature_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_feature" DROP CONSTRAINT "fk_property_feature_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_publication" DROP CONSTRAINT "fk_property_publication_portal_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_publication" DROP CONSTRAINT "fk_property_publication_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP CONSTRAINT "fk_appointment_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP CONSTRAINT "fk_appointment_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP CONSTRAINT "fk_appointment_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_assignment" DROP CONSTRAINT "fk_property_assignment_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_assignment" DROP CONSTRAINT "fk_property_assignment_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP CONSTRAINT "fk_refresh_token_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP CONSTRAINT "fk_client_assigned_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP CONSTRAINT "fk_client_city_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP CONSTRAINT "fk_client_source_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP CONSTRAINT "fk_client_stage_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP CONSTRAINT "fk_client_pipeline_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_interest" DROP CONSTRAINT "fk_property_interest_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_interest" DROP CONSTRAINT "fk_property_interest_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_assigned_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_label_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_zone_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_city_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_property_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property" DROP CONSTRAINT "fk_property_currency_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "property_image" DROP CONSTRAINT "fk_property_image_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pipeline_stage" DROP CONSTRAINT "fk_pipeline_stage_pipeline_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_shift" DROP CONSTRAINT "fk_agent_shift_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "zone" DROP CONSTRAINT "fk_zone_city_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "city" DROP CONSTRAINT "fk_city_region_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "region" DROP CONSTRAINT "fk_region_country_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_client_type_client_type_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_client_type_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "client_client_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_feature_feature_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_feature_property_id"`,
    );
    await queryRunner.query(`DROP TABLE "property_feature"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_publication_portal_id_state"`,
    );
    await queryRunner.query(`DROP TABLE "property_publication"`);
    await queryRunner.query(
      `DROP TYPE "public"."property_publication_state_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointment_agent_id_starts_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointment_starts_at_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_appointment_property_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_appointment_client_id"`);
    await queryRunner.query(`DROP TABLE "appointment"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_assignment_property_id_unassigned_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_assignment_agent_id"`,
    );
    await queryRunner.query(`DROP TABLE "property_assignment"`);
    await queryRunner.query(
      `DROP TYPE "public"."property_assignment_role_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_refresh_token_token_hash"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_refresh_token_agent_id"`);
    await queryRunner.query(`DROP TABLE "refresh_token"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_pipeline_id_stage_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_assigned_agent_id_stage_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_last_contacted_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_assigned_agent_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_client_source_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_phone_normalized"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_client_wasi_id"`);
    await queryRunner.query(`DROP TABLE "client"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'search_text', 'serrano', 'public', 'client'],
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_interest_property_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_interest_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "property_interest"`);
    await queryRunner.query(
      `DROP TYPE "public"."property_interest_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."property_interest_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_availability_publication_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_city_id_zone_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_property_sale_price"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_latitude_longitude"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_assigned_agent_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_property_type_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_property_for_rent"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_for_sale"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_code"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_wasi_id"`);
    await queryRunner.query(`DROP TABLE "property"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'search_text', 'serrano', 'public', 'property'],
    );
    await queryRunner.query(
      `DROP TYPE "public"."property_publication_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."property_availability_enum"`);
    await queryRunner.query(`DROP TYPE "public"."property_condition_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."property_map_publication_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."property_rent_period_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_label_name"`);
    await queryRunner.query(`DROP INDEX "public"."idx_property_label_wasi_id"`);
    await queryRunner.query(`DROP TABLE "property_label"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_image_property_id_position"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_property_image_checksum"`,
    );
    await queryRunner.query(`DROP TABLE "property_image"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lead_source_name"`);
    await queryRunner.query(`DROP TABLE "lead_source"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_pipeline_stage_pipeline_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_pipeline_stage_wasi_id"`);
    await queryRunner.query(`DROP TABLE "pipeline_stage"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pipeline_name"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pipeline_wasi_id"`);
    await queryRunner.query(`DROP TABLE "pipeline"`);
    await queryRunner.query(`DROP INDEX "public"."idx_agent_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_agent_email"`);
    await queryRunner.query(`DROP INDEX "public"."idx_agent_wasi_id"`);
    await queryRunner.query(`DROP TABLE "agent"`);
    await queryRunner.query(`DROP TYPE "public"."agent_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."agent_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_agent_shift_agent_id_weekday"`,
    );
    await queryRunner.query(`DROP TABLE "agent_shift"`);
    await queryRunner.query(`DROP TYPE "public"."agent_shift_kind_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_zone_city_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_zone_name"`);
    await queryRunner.query(`DROP TABLE "zone"`);
    await queryRunner.query(`DROP INDEX "public"."idx_city_region_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_city_name"`);
    await queryRunner.query(`DROP TABLE "city"`);
    await queryRunner.query(`DROP INDEX "public"."idx_region_country_id"`);
    await queryRunner.query(`DROP TABLE "region"`);
    await queryRunner.query(`DROP TABLE "country"`);
    await queryRunner.query(`DROP TABLE "portal"`);
    await queryRunner.query(`DROP TABLE "client_type"`);
    await queryRunner.query(`DROP TABLE "currency"`);
    await queryRunner.query(`DROP INDEX "public"."idx_feature_scope"`);
    await queryRunner.query(`DROP TABLE "feature"`);
    await queryRunner.query(`DROP TYPE "public"."feature_scope_enum"`);
    await queryRunner.query(`DROP TABLE "property_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_activity_client_id_occurred_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_activity_property_id_occurred_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_activity_occurred_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_activity_agent_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_activity_type"`);
    await queryRunner.query(`DROP TABLE "activity"`);
    await queryRunner.query(`DROP TYPE "public"."activity_type_enum"`);
  }
}
