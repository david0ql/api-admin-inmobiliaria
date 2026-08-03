import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatHistory1785726968808 implements MigrationInterface {
  name = 'ChatHistory1785726968808';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."assistant_rule_source_enum" AS ENUM('MANUAL', 'REVIEW')`,
    );
    await queryRunner.query(
      `CREATE TABLE "assistant_rule" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "text" text NOT NULL, "active" boolean NOT NULL DEFAULT true, "source" "public"."assistant_rule_source_enum" NOT NULL DEFAULT 'MANUAL', "review_id" uuid, "position" integer NOT NULL DEFAULT '0', CONSTRAINT "pk_assistant_rule_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "assistant_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "post_prompt" text NOT NULL DEFAULT '', CONSTRAINT "pk_assistant_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_message" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "conversation_id" uuid NOT NULL, "role" text NOT NULL, "content" text NOT NULL, "position" integer NOT NULL, CONSTRAINT "pk_chat_message_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_message_conversation_id" ON "chat_message"  ("conversation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_conversation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "client_id" uuid NOT NULL, "property_code" text, "last_message_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "message_count" integer NOT NULL DEFAULT '0', "ip_address" text, CONSTRAINT "pk_chat_conversation_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_conversation_client_id" ON "chat_conversation"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_conversation_last_message_at" ON "chat_conversation"  ("last_message_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_review" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "conversation_id" uuid NOT NULL, "message_id" uuid, "issues" jsonb NOT NULL DEFAULT '[]', "comment" text NOT NULL, "suggested_rule" text, "applied_rule_id" uuid, "reviewed_by_agent_id" uuid NOT NULL, CONSTRAINT "pk_chat_review_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_review_conversation_id" ON "chat_review"  ("conversation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_message" ADD CONSTRAINT "fk_chat_message_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversation" ADD CONSTRAINT "fk_chat_conversation_client_id" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_review" ADD CONSTRAINT "fk_chat_review_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_review" ADD CONSTRAINT "fk_chat_review_reviewed_by_agent_id" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_review" DROP CONSTRAINT "fk_chat_review_reviewed_by_agent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_review" DROP CONSTRAINT "fk_chat_review_conversation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversation" DROP CONSTRAINT "fk_chat_conversation_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_message" DROP CONSTRAINT "fk_chat_message_conversation_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_review_conversation_id"`,
    );
    await queryRunner.query(`DROP TABLE "chat_review"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_conversation_last_message_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_conversation_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "chat_conversation"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_message_conversation_id"`,
    );
    await queryRunner.query(`DROP TABLE "chat_message"`);
    await queryRunner.query(`DROP TABLE "assistant_settings"`);
    await queryRunner.query(`DROP TABLE "assistant_rule"`);
    await queryRunner.query(`DROP TYPE "public"."assistant_rule_source_enum"`);
  }
}
