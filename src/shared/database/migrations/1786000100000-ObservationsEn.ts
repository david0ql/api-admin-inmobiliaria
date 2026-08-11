import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La descripcion del asesor, en ingles.
 *
 * Columna propia y no fila en la tabla de traducciones: no es una frase de la
 * web sino texto libre sobre un inmueble concreto, y hay uno distinto por
 * ficha.
 */
export class ObservationsEn1786000100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "property" ADD COLUMN "observations_en" text',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "property" DROP COLUMN "observations_en"',
    );
  }
}
