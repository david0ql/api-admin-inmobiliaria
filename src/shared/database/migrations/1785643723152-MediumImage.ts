import { MigrationInterface, QueryRunner } from 'typeorm';

export class MediumImage1785643723152 implements MigrationInterface {
  name = 'MediumImage1785643723152';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "property_image" ADD "url_medium" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "property_image" DROP COLUMN "url_medium"`,
    );
  }
}
