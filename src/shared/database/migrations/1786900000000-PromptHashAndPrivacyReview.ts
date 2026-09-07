import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Con que TEXTO se produjo cada analisis, no solo con que numero de version.
 *
 * El encargo era poder afinar el prompt, y afinar es cambiar, volver a medir y
 * comparar. Para comparar hace falta saber que texto produjo cada resultado, y
 * `prompt_version` no lo dice: es una indireccion. Nada en el esquema impide
 * editar el `body` de una version ya usada, y la version 1 se siembra desde un
 * fichero del repositorio que viaja con el codigo, asi que "los resultados de
 * la v1" puede querer decir textos distintos en dos despliegues.
 *
 * Y sobre todo, el numero no distingue los dos casos que aparecen justo cuando
 * uno edita el prompt y no ve cambios: "se aplico y no movio nada" y "no se
 * aplico". Son conclusiones opuestas —una dice que el cambio no sirve, la otra
 * que hay un fallo— y con la version se ven igual. Con la huella, o coincide
 * con la del texto activo o no coincide.
 *
 * Aditiva y nula hacia atras: los analisis anteriores se quedan sin huella, que
 * es lo honesto. No significa que no hubiera texto, significa que no se apunto
 * cual.
 *
 * Va en las dos tablas de resultado porque el juicio del album se produce con
 * el mismo texto y en la misma llamada que el de cada foto: si solo lo llevara
 * una, comparar el orden propuesto entre versiones seguiria sin poderse.
 *
 * --------------------------------------------------------------------------
 *
 * Y la segunda mitad: quien reviso una marca de datos personales, y cuando.
 *
 * El modelo marca alrededor de 1 de cada 20 fotos y se equivoca en algunas —
 * midiendo sobre 114 fotos reales aparecieron un cartel de "Feliz Cumpleaños" y
 * un globo con forma de tres descritos como "fotos de personas en marcos
 * pequeños"—. Si esas marcas no se pueden quitar, se quedan ahi para siempre y
 * el asesor aprende a ignorar el bloque entero: asi es como se pierde una
 * funcion que existe por un riesgo legal.
 *
 * Lo valioso NO es el descarte, es la constancia. Un "ya lo he mirado" que solo
 * viviera en el navegador reapareceria al recargar, no existiria en el
 * ordenador de al lado, y sobre todo aparentaria cerrar algo sin dejar rastro
 * de que alguien lo miro. Para una marca de riesgo legal ese es justo el boton
 * que no hay que pintar — el mismo error que el "revisado, sin caras" que ya se
 * descarto. Por eso se guardan las tres cosas y no solo el booleano: un falso
 * positivo descartado por Ana el martes es informacion; un booleano suelto no.
 */
export class PromptHashAndPrivacyReview1786900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    for (const tabla of ['image_analysis', 'image_album_analysis']) {
      await q.query(`
        ALTER TABLE "${tabla}" ADD COLUMN "prompt_hash" varchar(16)`);
    }

    /*
      El indice va sobre (version, huella) y no sobre la huella sola.

      La pregunta que se hace es "de todo lo que dice ser la version 4, ¿que
      salio de verdad de este texto?", y esa se contesta con las dos columnas.
      Un indice solo sobre la huella serviria para buscar por un valor que nadie
      teclea de memoria.
    */
    await q.query(`
      CREATE INDEX "IDX_image_analysis_prompt"
        ON "image_analysis" ("prompt_version", "prompt_hash")`);

    // --- revision de la marca de datos personales ------------------------

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
      La comprobacion lo impone en la base y no solo en el codigo, porque el
      dia que otra ruta escriba en esta tabla se olvidara de las otras dos.
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
    await q.query(`DROP INDEX IF EXISTS "IDX_image_analysis_prompt"`);
    for (const tabla of ['image_analysis', 'image_album_analysis']) {
      await q.query(`
        ALTER TABLE "${tabla}" DROP COLUMN IF EXISTS "prompt_hash"`);
    }
  }
}
