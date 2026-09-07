import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuando se acepto el retoque que se esta viendo en una foto.
 *
 * Va aparte de `1787300000000-ImageRetouch` porque aquella ya corrio. Y va en
 * `property_image` duplicando el `decided_at` de la fila del retoque, que es
 * una duplicidad a proposito: la pregunta "¿esta foto es una fotografia?" se
 * hace desde la galeria, desde el visor y desde la ficha publica, y una marca
 * que obliga a un join para leerse es una marca que las pantallas acaban no
 * pintando. El catalogo donde no se distingue lo real de lo generado es
 * exactamente lo que hay que evitar.
 */
export class RetouchedAt1787600000000 implements MigrationInterface {
  name = 'RetouchedAt1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
      `PROCESANDO` faltaba en el tipo de Postgres.

      El retoque paso a ser asincrono despues de crear la tabla: una edicion
      real tarda entre 90 y 100 segundos y una peticion sincrona de minuto y
      medio no sobrevive al `proxy_read_timeout` de nginx. La fila se crea ahora
      ANTES de llamar al proveedor, y necesitaba un estado para ese rato.

      `ADD VALUE` dentro de una transaccion lo permite Postgres desde la 12
      —aqui corre la 16— mientras el valor nuevo no se USE en la misma
      transaccion. La actualizacion de abajo no lo menciona, asi que entra.
    */
    await queryRunner.query(
      `ALTER TYPE "retouch_status_enum" ADD VALUE IF NOT EXISTS 'PROCESANDO' BEFORE 'PENDIENTE'`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_image" ADD "retouched_at" TIMESTAMP WITH TIME ZONE`,
    );
    /*
      Las fotos que ya tenian un retoque aplicado —si las hubiera— se rellenan
      desde la fila que las marco. Hoy no hay ninguna en produccion, pero la
      migracion no puede depender de eso: en la copia de pruebas si las hay, y
      dejarlas con la marca puesta y sin fecha seria una marca a medias.
    */
    await queryRunner.query(`
      UPDATE "property_image" pi
         SET "retouched_at" = r."decided_at"
        FROM "image_retouch" r
       WHERE r."id" = pi."retouch_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "property_image" DROP COLUMN "retouched_at"`,
    );
  }
}
