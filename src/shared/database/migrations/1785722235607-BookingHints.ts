import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingHints1785722235607 implements MigrationInterface {
  name = 'BookingHints1785722235607';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "booking_settings" ADD "suggested_properties" integer NOT NULL DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_settings" ALTER COLUMN "suggested_slots" SET DEFAULT '2'`,
    );

    // La fila ya existe con los valores anteriores: cambiar el DEFAULT de
    // la columna no la toca. Se ponen los que pidio la agencia — tres
    // inmuebles y dos horarios— salvo que alguien ya los haya ajustado a
    // mano desde el panel.
    await queryRunner.query(
      `UPDATE "booking_settings" SET "suggested_slots" = 2 WHERE "suggested_slots" = 3`,
    );
    await queryRunner.query(
      `UPDATE "booking_settings" SET "suggested_properties" = 3 WHERE "suggested_properties" = 4`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "booking_settings" ALTER COLUMN "suggested_slots" SET DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_settings" DROP COLUMN "suggested_properties"`,
    );
  }
}
