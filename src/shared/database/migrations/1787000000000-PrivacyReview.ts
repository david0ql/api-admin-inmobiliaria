import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quien reviso una marca de datos personales, y cuando.
 *
 * El modelo marca alrededor de 1 de cada 20 fotos y se equivoca en algunas:
 * midiendo sobre 114 fotos reales aparecieron un cartel de "Feliz Cumpleaños" y
 * un globo con forma de tres descritos como "fotos de personas en marcos
 * pequeños". Si esas marcas no se pueden quitar se quedan ahi para siempre y el
 * asesor aprende a ignorar el bloque entero: asi es como se pierde una funcion
 * que existe por un riesgo legal.
 *
 * Lo valioso NO es el descarte, es la constancia. Un "ya lo he mirado" que solo
 * viviera en el navegador reapareceria al recargar, no existiria en el
 * ordenador de al lado, y sobre todo aparentaria cerrar algo sin dejar rastro
 * de que alguien lo miro. Para una marca de riesgo legal ese es justo el boton
 * que no hay que pintar — el mismo error que el "revisado, sin caras" que ya se
 * descarto. Un falso positivo descartado por Ana el martes es informacion; un
 * booleano suelto no lo es.
 *
 * Va aparte de `1786900000000` y no dentro, aunque se pidieran juntas, porque
 * aquella YA SE EJECUTO en produccion. TypeORM decide por el timestamp: una
 * migracion ya registrada no vuelve a correr, asi que ampliarla habria dejado
 * estas tres columnas sin crear en el unico sitio donde importan, y el codigo
 * nuevo habria fallado en caliente escribiendo en columnas inexistentes — sin
 * que ningun build ni ninguna prueba lo avisara. Una migracion ejecutada es un
 * hecho del pasado y no se reescribe.
 */
export class PrivacyReview1787000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "image_analysis"
        ADD COLUMN "privacy_dismissed" boolean NOT NULL DEFAULT false,
        ADD COLUMN "privacy_reviewed_at" timestamptz,
        ADD COLUMN "privacy_reviewed_by_agent_id" uuid
          REFERENCES "agent"("id") ON DELETE SET NULL`);

    /*
      Las tres van juntas o no van.

      Un descarte sin fecha ni autor es un booleano que nadie puede rebatir seis
      meses despues, cuando alguien pregunte por que esa cara salio publicada.
      La comprobacion vive en la base y no solo en el codigo porque el dia que
      otra ruta escriba en esta tabla se olvidara de las otras dos.
    */
    await q.query(`
      ALTER TABLE "image_analysis"
        ADD CONSTRAINT "CHK_image_analysis_privacy_review"
        CHECK (
          ("privacy_dismissed" = false
             AND "privacy_reviewed_at" IS NULL
             AND "privacy_reviewed_by_agent_id" IS NULL)
          OR
          ("privacy_dismissed" = true
             AND "privacy_reviewed_at" IS NOT NULL)
        )`);

    // Lo que el panel pregunta: que marcas siguen sin revisar.
    await q.query(`
      CREATE INDEX "IDX_image_analysis_privacy_pendiente"
        ON "image_analysis" ("property_id")
        WHERE "privacy_dismissed" = false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX IF EXISTS "IDX_image_analysis_privacy_pendiente"`,
    );
    await q.query(`
      ALTER TABLE "image_analysis"
        DROP CONSTRAINT IF EXISTS "CHK_image_analysis_privacy_review"`);
    await q.query(`
      ALTER TABLE "image_analysis"
        DROP COLUMN IF EXISTS "privacy_dismissed",
        DROP COLUMN IF EXISTS "privacy_reviewed_at",
        DROP COLUMN IF EXISTS "privacy_reviewed_by_agent_id"`);
  }
}
