import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El retoque con IA: la tabla que guarda que se le pidio a un modelo sobre una
 * foto de inmueble, y la columna que marca las fotos del catalogo que ya no son
 * fotografias.
 *
 * La columna de `property_image` es la parte que de verdad importa dentro de
 * seis meses. Sin ella, la unica forma de saber si una imagen del catalogo la
 * dibujo un modelo seria mirarla y dudar: el fichero no lo dice, porque nuestro
 * propio reencodeo a WebP destruye la firma de procedencia C2PA que el
 * proveedor mete en el PNG.
 */
export class ImageRetouch1787300000000 implements MigrationInterface {
  name = 'ImageRetouch1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "retouch_kind_enum" AS ENUM (
        'REVELADO', 'ALTERACION', 'OCULTA_DEFECTO'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "retouch_status_enum" AS ENUM (
        'PENDIENTE', 'APLICADO', 'DESCARTADO', 'REVERTIDO', 'FALLIDO'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "image_retouch" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "property_image_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "instruction" character varying(1000) NOT NULL,
        "kind" "retouch_kind_enum" NOT NULL,
        "motivos" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "prompt_enviado" text NOT NULL,
        "model" character varying(80) NOT NULL,
        "quality" character varying(20) NOT NULL,
        "size" character varying(20) NOT NULL,
        "cost_usd" numeric(10,5) NOT NULL DEFAULT 0,
        "input_tokens" integer NOT NULL DEFAULT 0,
        "output_tokens" integer NOT NULL DEFAULT 0,
        "original_snapshot" jsonb NOT NULL,
        "retouched_snapshot" jsonb,
        "status" "retouch_status_enum" NOT NULL DEFAULT 'PENDIENTE',
        "requested_by_agent_id" uuid NOT NULL,
        "decided_by_agent_id" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "alteracion_asumida" boolean NOT NULL DEFAULT false,
        "error" text,
        CONSTRAINT "PK_image_retouch" PRIMARY KEY ("id")
      )
    `);

    /*
      En cascada con la foto: si la foto desaparece, su historial de retoques no
      describe nada. La direccion contraria —`property_image.retouch_id`— se
      deja SIN clave ajena a proposito, para no crear un ciclo entre las dos
      tablas que complicaria el borrado de un inmueble sin proteger nada mas.
    */
    await queryRunner.query(`
      ALTER TABLE "image_retouch"
      ADD CONSTRAINT "FK_image_retouch_image"
      FOREIGN KEY ("property_image_id") REFERENCES "property_image"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_image_retouch_image" ON "image_retouch" ("property_image_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_image_retouch_property" ON "image_retouch" ("property_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_image_retouch_status" ON "image_retouch" ("status")`,
    );

    /*
      La marca. Nula significa fotografia; no nula significa que lo que ve el
      visitante lo dibujo un modelo, y apunta a la fila que dice cual, con que
      instruccion y quien lo acepto.

      Las 6.306 imagenes que ya estan nacen con NULL, que es la verdad: ninguna
      se ha retocado.
    */
    await queryRunner.query(
      `ALTER TABLE "property_image" ADD "retouch_id" uuid`,
    );
    /*
      Indice parcial: solo interesan las filas marcadas, que van a ser unas
      pocas de miles. Un indice sobre la columna entera ocuparia lo mismo que
      uno sobre 6.306 nulos, que es espacio a cambio de nada.
    */
    await queryRunner.query(
      `CREATE INDEX "IDX_property_image_retouch" ON "property_image" ("retouch_id") WHERE "retouch_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_property_image_retouch"`);
    await queryRunner.query(
      `ALTER TABLE "property_image" DROP COLUMN "retouch_id"`,
    );
    await queryRunner.query(`DROP TABLE "image_retouch"`);
    await queryRunner.query(`DROP TYPE "retouch_status_enum"`);
    await queryRunner.query(`DROP TYPE "retouch_kind_enum"`);
  }
}
