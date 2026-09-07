import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El revelado automatico de las fotos, y como deshacerlo.
 *
 * Toda foto que entra pasa ahora por un revelado sin IA —niveles, balance de
 * blancos sobre las superficies claras, gamma si salio oscura y enfoque de
 * salida—, y el original se conserva aparte en disco (`-r.webp`). Estas dos
 * columnas son la parte de eso que tiene que estar en la base:
 *
 * - `developed_at` dice si la foto ya se miro. Es lo que permite revelar las
 *   6.306 que ya estaban en tandas, cortando y reanudando: lo pendiente es lo
 *   que la tiene a nulo. Un contador en un fichero no sobrevive a un reinicio
 *   ni sabe que fotos se anadieron mientras tanto.
 *
 * - `develop` dice QUE se le hizo. Sin ella, "esta foto salio rara" no tiene
 *   respuesta posible, y afinar el criterio obligaria a rerevelar las 6.306
 *   en lugar de solo las hechas con la version anterior.
 *
 * Las dos son nulas hacia atras y eso es exactamente lo que se quiere decir:
 * las fotos que ya estaban no se han revelado todavia.
 *
 * En las tres tablas porque son la misma pregunta —una foto es una foto,
 * cuelgue de un inmueble, de un proyecto o de una tipologia— y el revelado lo
 * aplica el mismo codigo para las tres.
 */
export class PhotoDevelop1787100000000 implements MigrationInterface {
  private readonly tablas = [
    'property_image',
    'family_image',
    'unit_type_image',
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`
        ALTER TABLE "${tabla}"
          ADD COLUMN "developed_at" timestamptz,
          ADD COLUMN "develop" jsonb`);

      /*
        Indice parcial sobre lo que falta por revelar.

        La consulta que se hace mil veces es "dame las siguientes N sin
        revelar", y sobre 6.306 filas un indice completo cuesta lo mismo que
        el escaneo. El parcial solo contiene lo pendiente, asi que se vacia
        solo segun avanza el proceso y no deja peso permanente en cada
        insercion posterior.
      */
      await q.query(`
        CREATE INDEX "IDX_${tabla}_sin_revelar"
          ON "${tabla}" ("id") WHERE "developed_at" IS NULL`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of this.tablas) {
      await q.query(`DROP INDEX IF EXISTS "IDX_${tabla}_sin_revelar"`);
      await q.query(`
        ALTER TABLE "${tabla}"
          DROP COLUMN IF EXISTS "develop",
          DROP COLUMN IF EXISTS "developed_at"`);
    }
  }
}
