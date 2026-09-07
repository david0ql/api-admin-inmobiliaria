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
 */
export class PromptHash1786900000000 implements MigrationInterface {
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
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_image_analysis_prompt"`);
    for (const tabla of ['image_analysis', 'image_album_analysis']) {
      await q.query(`
        ALTER TABLE "${tabla}" DROP COLUMN IF EXISTS "prompt_hash"`);
    }
  }
}
