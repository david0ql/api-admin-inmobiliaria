import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La foto sin revelar, publicada, para poder comparar.
 *
 * El revelado ya era reversible —el negativo se guarda entero en disco—, pero
 * no era COMPARABLE: la unica forma de ver como era la foto antes era quitarle
 * el revelado de verdad, o sea escribir sobre el anuncio de un cliente para
 * poder mirarlo. Y sin comparar no hay manera de contestar la pregunta que
 * origino todo esto, que es si la foto se ve mejor.
 *
 * Asi que el negativo pasa a tener sus dos tamanos publicables —listado y
 * ficha— y estas columnas los nombran. No se sirve el negativo tal cual porque
 * esta a 2560 px: una rejilla de comparacion de 6.306 fotos a ese tamano no se
 * pinta.
 *
 * Nulas hacia atras, y eso significa exactamente lo que parece: esa foto
 * todavia no ha pasado por el revelado, asi que lo que se ve ya es el antes.
 */
export class DevelopBefore1787400000000 implements MigrationInterface {
  private readonly tablas = [
    'property_image',
    'family_image',
    'unit_type_image',
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`
        ALTER TABLE "${tabla}"
          ADD COLUMN "url_raw" text,
          ADD COLUMN "url_raw_large" text`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`
        ALTER TABLE "${tabla}"
          DROP COLUMN IF EXISTS "url_raw_large",
          DROP COLUMN IF EXISTS "url_raw"`);
    }
  }
}
