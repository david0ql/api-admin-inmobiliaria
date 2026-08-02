import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientPortal1785646090146 implements MigrationInterface {
  name = 'ClientPortal1785646090146';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "client_refresh_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "client_id" uuid NOT NULL, "token_hash" character varying(128) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "user_agent" character varying(255), "ip_address" character varying(64), CONSTRAINT "pk_client_refresh_token_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_refresh_token_client_id" ON "client_refresh_token"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_client_refresh_token_token_hash" ON "client_refresh_token"  ("token_hash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "password_hash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "portal_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "must_change_password" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "self_registered" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "failed_login_attempts" smallint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "locked_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" ADD "last_portal_login_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_refresh_token" ADD CONSTRAINT "fk_client_refresh_token_client_id" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /*
     * Un correo, una cuenta. El indice es PARCIAL a proposito: la cartera
     * heredada tiene correos repetidos y correos vacios entre sus 7.529
     * fichas, y exigirles unicidad ahora romperia el import. La restriccion
     * solo alcanza a las fichas que pueden entrar al portal, que son las
     * que se dan de alta desde hoy.
     *
     * Sin esto, dos clientes con el mismo correo y credencial harian que el
     * login eligiese uno de los dos de forma arbitraria — y "arbitraria" en
     * una consulta de autenticacion significa que alguien acaba viendo la
     * ficha de otro.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_client_portal_email" ON "client" (LOWER("email")) WHERE "password_hash" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_client_portal_email"`);
    await queryRunner.query(
      `ALTER TABLE "client_refresh_token" DROP CONSTRAINT "fk_client_refresh_token_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP COLUMN "last_portal_login_at"`,
    );
    await queryRunner.query(`ALTER TABLE "client" DROP COLUMN "locked_until"`);
    await queryRunner.query(
      `ALTER TABLE "client" DROP COLUMN "failed_login_attempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP COLUMN "self_registered"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP COLUMN "must_change_password"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client" DROP COLUMN "portal_enabled"`,
    );
    await queryRunner.query(`ALTER TABLE "client" DROP COLUMN "password_hash"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_refresh_token_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_client_refresh_token_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "client_refresh_token"`);
  }
}
