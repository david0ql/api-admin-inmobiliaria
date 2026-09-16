import { MigrationInterface, QueryRunner } from 'typeorm';

export class VisitContactToken1787700000000 implements MigrationInterface {
  name = 'VisitContactToken1787700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment" ADD "public_access_token_hash" character varying(64)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP COLUMN "public_access_token_hash"`,
    );
  }
}
