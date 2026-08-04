import { MigrationInterface, QueryRunner } from "typeorm";

export class ShowcaseToggle1785875784215 implements MigrationInterface {
    name = 'ShowcaseToggle1785875784215'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "home_settings" ADD "enabled" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "home_settings" DROP COLUMN "enabled"`);
    }

}
