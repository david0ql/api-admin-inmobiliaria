import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Galería de proyecto, planos de tipología, y saber cuál es cuál.
 *
 * Faltaban las dos puntas del catálogo de obra nueva: un proyecto tenía UNA
 * portada escrita como texto —`cover_url`— y una tipología no tenía ninguna
 * imagen, cuando el plano es justo lo que abre quien compara el Tipo A con el
 * Tipo B. Se resuelve con dos tablas nuevas y una columna.
 *
 * Dos tablas y no una polimórfica con `owner_type` + `owner_id`: así cada
 * imagen tiene su clave ajena de verdad, el borrado en cascada lo hace la base
 * y no cada servicio a mano, y una fila no puede quedarse apuntando a un
 * proyecto que ya no existe. Lo que se repetiría —subir, ordenar, elegir
 * portada, borrar— no se repite: vive una sola vez en
 * `ImageCollectionService`.
 *
 * `kind` va también en `property_image` porque un inmueble suelto también
 * tiene plano —un lote con su levantamiento, una casa con su distribución— y
 * hasta ahora entraba al carrusel como una foto más entre la cocina y el baño.
 * El tipo de Postgres es uno solo y compartido: es la misma pregunta en las
 * tres tablas.
 */
export class ImageGalleries1786600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "image_kind_enum" AS ENUM ('PHOTO', 'FLOOR_PLAN')`,
    );

    /*
      Las 6.306 filas existentes son fotos: se importaron de las galerías de
      WASI, donde no había planos. El DEFAULT las deja marcadas sin recorrer la
      tabla, y lo que sea plano lo dirá la agencia desde el panel.
    */
    await q.query(`
      ALTER TABLE "property_image"
        ADD COLUMN "kind" "image_kind_enum" NOT NULL DEFAULT 'PHOTO'`);

    for (const { tabla, columna, referencia } of [
      {
        tabla: 'family_image',
        columna: 'family_id',
        referencia: 'property_family',
      },
      {
        tabla: 'unit_type_image',
        columna: 'unit_type_id',
        referencia: 'unit_type',
      },
    ]) {
      await q.query(`
        CREATE TABLE "${tabla}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "created_at" timestamptz NOT NULL DEFAULT now(),
          "updated_at" timestamptz NOT NULL DEFAULT now(),
          "deleted_at" timestamptz,
          "${columna}" uuid NOT NULL,
          "storage_key" varchar(300) NOT NULL,
          "url" text NOT NULL,
          "url_medium" text,
          "url_large" text NOT NULL,
          "url_original" text NOT NULL,
          "checksum" varchar(64),
          "width" int,
          "height" int,
          "bytes" int,
          "description" varchar(300),
          "kind" "image_kind_enum" NOT NULL DEFAULT 'PHOTO',
          "position" smallint NOT NULL DEFAULT 1,
          "is_main" boolean NOT NULL DEFAULT false,
          CONSTRAINT "pk_${tabla}_id" PRIMARY KEY ("id"),
          CONSTRAINT "fk_${tabla}_${columna}" FOREIGN KEY ("${columna}")
            REFERENCES "${referencia}"("id") ON DELETE CASCADE
        )`);

      /*
        Los nombres se escriben a mano y no se dejan a Postgres —que pondria
        `family_image_pkey`— porque son los que genera `SnakeNamingStrategy`:
        con otros, el primer `migration:generate` que alguien lance propondra
        renombrarlos todos.

        El indice es el mismo par que en `property_image`: la galería siempre
        se lee de un dueño y ordenada, nunca por id suelto.
      */
      await q.query(
        `CREATE INDEX "idx_${tabla}_${columna}_position"
           ON "${tabla}" ("${columna}", "position")`,
      );
      await q.query(
        `CREATE INDEX "idx_${tabla}_checksum" ON "${tabla}" ("checksum")`,
      );
    }

    /*
      `property_family.cover_url` se queda y NO se traspasa a la galería.

      Los cinco proyectos que la tienen apuntan a una foto de uno de sus
      propios inmuebles (`/media/properties/<id>/...`): copiarla como fila de
      `family_image` haría que borrar esa imagen del proyecto se llevara del
      disco la foto del inmueble, que sigue siendo suya. La columna sobrevive
      como respaldo —la web usa la portada de la galería cuando la hay, y esa
      URL cuando no— y se apagará sola según se suban galerías de verdad.
    */
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "unit_type_image"`);
    await q.query(`DROP TABLE IF EXISTS "family_image"`);
    await q.query(`ALTER TABLE "property_image" DROP COLUMN IF EXISTS "kind"`);
    await q.query(`DROP TYPE IF EXISTS "image_kind_enum"`);
  }
}
