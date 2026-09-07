import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La propuesta de encuadre de cada foto.
 *
 * El analisis con IA ya decia si una foto estaba bien o mal; lo que no decia es
 * QUE hacerle. Esta columna guarda eso: por que borde sobra algo, cuanto sobra,
 * que hay ahi, y si el recorte se puede aplicar solo o tiene que mirarlo un
 * asesor.
 *
 * Una columna `jsonb` y no cuatro columnas sueltas porque lo que se guarda es
 * una lista de longitud variable —una foto puede tener dos bordes muertos— y
 * porque nada de esto se consulta ni se ordena por SQL: se lee entera con la
 * fila del analisis y se pinta. Lo que si se consulta es la via, y para eso ya
 * esta el indice de abajo.
 *
 * Nula hacia atras a proposito: los analisis que ya estaban no traen propuesta,
 * y decir eso es mas util que rellenarlos con una vacia, que se leeria como
 * "esta foto no necesita nada".
 */
export class ImageFraming1787200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "image_analysis" ADD COLUMN "framing" jsonb`);

    /*
      Indice sobre la via, que es la unica pregunta que se hace por SQL:
      "dame las fotos de este inmueble que el sistema puede arreglar solo".
      Parcial, porque las que no tienen propuesta —que son la mayoria— no se
      buscan nunca y no tienen por que pesar en cada insercion.
    */
    await q.query(`
      CREATE INDEX "IDX_image_analysis_via"
        ON "image_analysis" (("framing" ->> 'via'))
        WHERE "framing" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_image_analysis_via"`);
    await q.query(
      `ALTER TABLE "image_analysis" DROP COLUMN IF EXISTS "framing"`,
    );
  }
}
