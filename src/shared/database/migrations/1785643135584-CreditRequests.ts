import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreditRequests1785643135584 implements MigrationInterface {
  name = 'CreditRequests1785643135584';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_status_enum" AS ENUM('NEW', 'REVIEWING', 'SUBMITTED', 'PREAPPROVED', 'REJECTED', 'DROPPED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_document_type_enum" AS ENUM('CC', 'CE', 'PASSPORT', 'NIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_gender_enum" AS ENUM('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_occupation_enum" AS ENUM('SALARIED', 'PENSIONER', 'SELF_EMPLOYED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_portfolio_type_enum" AS ENUM('VIS', 'NON_VIS')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_housing_type_enum" AS ENUM('NEW', 'USED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_request_product_enum" AS ENUM('MORTGAGE', 'HOUSING_LEASING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "credit_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "reference" character varying(20) NOT NULL, "status" "public"."credit_request_status_enum" NOT NULL DEFAULT 'NEW', "first_name" character varying(160) NOT NULL, "last_name" character varying(160) NOT NULL, "birth_date" date NOT NULL, "phone" character varying(40) NOT NULL, "email" character varying(180) NOT NULL, "document_type" "public"."credit_request_document_type_enum" NOT NULL, "document_number" character varying(40) NOT NULL, "gender" "public"."credit_request_gender_enum", "occupation" "public"."credit_request_occupation_enum" NOT NULL, "monthly_income" numeric(16,2), "portfolio_type" "public"."credit_request_portfolio_type_enum" NOT NULL, "housing_type" "public"."credit_request_housing_type_enum" NOT NULL, "product" "public"."credit_request_product_enum" NOT NULL, "term_years" smallint NOT NULL, "work_city_id" integer, "work_city_name" character varying(160) NOT NULL, "amount" numeric(16,2) NOT NULL, "has_property_picked" boolean NOT NULL DEFAULT false, "property_value" numeric(16,2), "property_code" character varying(40), "property_id" uuid, "co_applicant" jsonb, "notes" text, "accepted_terms_at" TIMESTAMP WITH TIME ZONE NOT NULL, "submitted_from_ip" character varying(64), "client_id" uuid, "assigned_agent_id" uuid, "reviewed_by_agent_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "institution" character varying(160), "resolution" character varying(500), CONSTRAINT "pk_credit_request_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_credit_request_reference" ON "credit_request"  ("reference") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_request_phone" ON "credit_request"  ("phone") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_request_email" ON "credit_request"  ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_request_status_created_at" ON "credit_request"  ("status", "created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_credit_request_status_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_credit_request_email"`);
    await queryRunner.query(`DROP INDEX "public"."idx_credit_request_phone"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_credit_request_reference"`,
    );
    await queryRunner.query(`DROP TABLE "credit_request"`);
    await queryRunner.query(`DROP TYPE "public"."credit_request_product_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."credit_request_housing_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."credit_request_portfolio_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."credit_request_occupation_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."credit_request_gender_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."credit_request_document_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."credit_request_status_enum"`);
  }
}
