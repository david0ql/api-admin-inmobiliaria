import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El recorte aplicado a una foto.
 *
 * Guarda la DECISION —una caja en fracciones de 0 a 1— y no el resultado, que
 * es el mismo criterio que ya usa `develop`: las variantes se regeneran desde
 * el negativo aplicandola. De ahi salen las dos propiedades que hacen esto
 * seguro sobre fotos de clientes reales: recortar se deshace poniendo la
 * columna a nulo, y recortar dos veces no acumula, porque la segunda caja se
 * mide sobre la foto entera y no sobre la ya recortada.
 *
 * En las tres tablas por lo mismo que `develop`: una foto es una foto, cuelgue
 * de un inmueble, de un proyecto o de una tipologia, y el recorte lo aplica el
 * mismo codigo para las tres.
 *
 * Nula hacia atras, que quiere decir la foto entera. Es la verdad: ninguna de
 * las 6.306 esta recortada.
 */
export class ImageCrop1787300000000 implements MigrationInterface {
  private readonly tablas = [
    'property_image',
    'family_image',
    'unit_type_image',
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`ALTER TABLE "${tabla}" ADD COLUMN "crop" jsonb`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`ALTER TABLE "${tabla}" DROP COLUMN IF EXISTS "crop"`);
    }
  }
}
