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
 *
 * ---
 *
 * NO SE RENUMERA, aunque comparta timestamp con `ImageRetouch1787300000000`.
 *
 * El choque es real y feo, pero corregirlo ahora tumba el despliegue. TypeORM
 * decide que esta pendiente comparando el NOMBRE DE LA CLASE, no el timestamp
 * (`MigrationExecutor.getPendingMigrations`: `executedMigration.name ===
 * migration.name`), y las dos migraciones YA ESTAN EJECUTADAS en produccion —
 * comprobado en la tabla `migrations`, y la columna `crop` ya existe.
 * Renombrar la clase la volveria a dejar pendiente, se reejecutaria el
 * `ADD COLUMN "crop"` sobre una tabla que ya lo tiene y el arranque fallaria.
 *
 * Convivir con el duplicado es inofensivo: el timestamp solo ordena lo que
 * esta PENDIENTE, ya no lo esta ninguna de las dos, y en una base nueva las
 * dos son `ADD COLUMN` de columnas distintas en tablas distintas, asi que el
 * orden entre ellas da igual.
 *
 * Lo que si hay que hacer es no repetirlo: los timestamps libres empiezan en
 * 1787700000000.
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
