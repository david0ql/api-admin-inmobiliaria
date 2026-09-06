import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calidad de imagenes: la puerta de codigo y el analisis con IA.
 *
 * Cuatro tablas y una columna:
 *
 * - `image_gate_settings`: lo que la agencia ha cambiado de los umbrales, un
 *   perfil por fila. Solo lo TOCADO, en `jsonb`: guardar la tabla entera
 *   congelaria en la primera edicion los umbrales que nadie quiso mover.
 *
 * - `image_prompt`: el prompt del analisis, versionado. No se sobrescribe, se
 *   apila; volver atras es activar un numero anterior. Sin esto no se puede
 *   afinar un prompt, porque afinar es probar y volver.
 *
 * - `image_analysis`: el juicio del modelo por foto, con la version del prompt
 *   y el modelo que lo produjeron. Esa pareja es la clave del asunto: sin ella
 *   no hay forma de contestar a "¿el cambio de ayer mejoro o empeoro?".
 *
 * - `image_album_analysis`: el juicio del conjunto —orden, portada y que falta—,
 *   que solo se puede emitir viendo la galeria entera.
 *
 * - `property.is_sample`: fichas de prueba, que no son inmuebles.
 *
 * Y una columna mas, `perceptual_hash`, en las tres tablas de imagenes: la
 * huella de la escena. `checksum` solo caza el mismo fichero bit a bit, y las
 * repetidas de verdad llegan reexportadas o por WhatsApp — en produccion hay
 * 530 imagenes con checksum repetido y 844 en grupos con la misma huella.
 */
export class ImageAi1786700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TYPE "image_gate_profile_enum" AS ENUM ('INVENTORY', 'REQUEST')`);

    await q.query(`
      CREATE TYPE "image_room_kind_enum" AS ENUM (
        'FACADE','LOBBY','LIVING','DINING','KITCHEN','BEDROOM','BATHROOM',
        'STUDY','LAUNDRY','BALCONY','TERRACE','GARDEN','POOL','GARAGE',
        'COMMON_AREA','GYM','VIEW','FLOOR_PLAN','EXTERIOR','DETAIL','OTHER')`);

    await q.query(`
      CREATE TABLE "image_gate_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "profile" "image_gate_profile_enum" NOT NULL,
        "overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_by_agent_id" uuid REFERENCES "agent"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_image_gate_settings_profile" UNIQUE ("profile")
      )`);

    await q.query(`
      CREATE TABLE "image_prompt" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "version" int NOT NULL,
        "body" text NOT NULL,
        "notes" varchar(500),
        "active" boolean NOT NULL DEFAULT false,
        "created_by_agent_id" uuid REFERENCES "agent"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_image_prompt_version" UNIQUE ("version")
      )`);

    /*
      Como mucho una version activa, y lo dice la base.

      Es un indice unico parcial y no una comprobacion en el codigo porque el
      dia que dos peticiones guarden un prompt a la vez, la comprobacion en
      codigo deja dos activas y a partir de ahi cada analisis usa la que le
      toque en el `findOne`, sin que nadie entienda por que los resultados
      cambian solos.
    */
    await q.query(`
      CREATE UNIQUE INDEX "UQ_image_prompt_active"
        ON "image_prompt" ("active") WHERE "active" = true`);

    await q.query(`
      CREATE TABLE "image_analysis" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "property_image_id" uuid NOT NULL REFERENCES "property_image"("id") ON DELETE CASCADE,
        "property_id" uuid NOT NULL REFERENCES "property"("id") ON DELETE CASCADE,
        "room" "image_room_kind_enum" NOT NULL DEFAULT 'OTHER',
        "room_confidence" real NOT NULL DEFAULT 0,
        "quality" smallint NOT NULL DEFAULT 0,
        "cover_score" smallint NOT NULL DEFAULT 0,
        "caption" varchar(300),
        "issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "fixes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "privacy" jsonb NOT NULL DEFAULT '{"faces":false,"plates":false,"documents":false,"screens":false,"notes":null}'::jsonb,
        "usable" boolean NOT NULL DEFAULT true,
        "prompt_version" int NOT NULL,
        "model" varchar(80) NOT NULL,
        "batch_id" uuid,
        "metrics" jsonb,
        "created_by_agent_id" uuid REFERENCES "agent"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_image_analysis_quality" CHECK ("quality" BETWEEN 0 AND 100),
        CONSTRAINT "CHK_image_analysis_cover" CHECK ("cover_score" BETWEEN 0 AND 100),
        CONSTRAINT "CHK_image_analysis_confidence" CHECK ("room_confidence" BETWEEN 0 AND 1)
      )`);

    /*
      Una respuesta por (foto, version del prompt, modelo).

      Repetir la MISMA pregunta pisa la respuesta anterior; preguntar con otro
      prompt deja una fila nueva al lado. Esa distincion es todo el mecanismo
      de comparacion entre versiones del prompt: sin ella, o se pierde el
      historial o se llena la tabla de duplicados.
    */
    await q.query(`
      CREATE UNIQUE INDEX "UQ_image_analysis_pregunta"
        ON "image_analysis" ("property_image_id", "prompt_version", "model")`);
    await q.query(`
      CREATE INDEX "IDX_image_analysis_property" ON "image_analysis" ("property_id")`);
    await q.query(`
      CREATE INDEX "IDX_image_analysis_image" ON "image_analysis" ("property_image_id")`);
    await q.query(`
      CREATE INDEX "IDX_image_analysis_batch" ON "image_analysis" ("batch_id")`);

    await q.query(`
      CREATE TABLE "image_album_analysis" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "property_id" uuid NOT NULL REFERENCES "property"("id") ON DELETE CASCADE,
        "batch_id" uuid NOT NULL,
        "suggested_order" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "cover_image_id" uuid REFERENCES "property_image"("id") ON DELETE SET NULL,
        "missing" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "summary" text,
        "prompt_version" int NOT NULL,
        "model" varchar(80) NOT NULL,
        "created_by_agent_id" uuid REFERENCES "agent"("id") ON DELETE SET NULL
      )`);
    await q.query(`
      CREATE INDEX "IDX_image_album_analysis_property"
        ON "image_album_analysis" ("property_id")`);

    // --- huella perceptual en las tres galerias ---------------------------

    /*
      Nullable y sin rellenar hacia atras.

      Calcularla para las 6.306 que ya estan significaria reabrir 4,5 GB de
      ficheros dentro de una migracion, con el despliegue parado. Se calcula al
      subir; lo viejo se queda en NULL y no estorba, porque comparar contra NULL
      simplemente no encuentra pareja.
    */
    for (const tabla of ['property_image', 'family_image', 'unit_type_image']) {
      const existe = await q.hasTable(tabla);
      if (!existe) continue;
      await q.query(`
        ALTER TABLE "${tabla}" ADD COLUMN "perceptual_hash" varchar(16)`);
      await q.query(`
        CREATE INDEX "IDX_${tabla}_perceptual_hash"
          ON "${tabla}" ("perceptual_hash")`);
    }

    // --- inmuebles de muestra -------------------------------------------

    await q.query(`
      ALTER TABLE "property"
        ADD COLUMN "is_sample" boolean NOT NULL DEFAULT false`);

    /*
      Un inmueble de muestra NO puede salir de borrador.

      Este CHECK es lo que hace cierta la promesa de "no publicados". Los
      listados publicos filtran por estado publicado; si la base impide que un
      `is_sample` tenga ese estado, no hay consulta publica que pueda
      devolverlo, hoy ni el dia que alguien anada una nueva y se olvide del
      filtro. Un `WHERE is_sample = false` repartido por doce sitios no da esa
      garantia: basta con que falte en uno.
    */
    await q.query(`
      ALTER TABLE "property"
        ADD CONSTRAINT "CHK_property_sample_is_draft"
        CHECK (NOT "is_sample" OR "publication_status" = 'DRAFT')`);

    // Parcial: los de muestra son un punado y los reales son 642. Un indice
    // sobre toda la tabla para encontrar tres filas no lo usaria el planificador.
    await q.query(`
      CREATE INDEX "IDX_property_is_sample"
        ON "property" ("is_sample") WHERE "is_sample" = true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of ['property_image', 'family_image', 'unit_type_image']) {
      await q.query(`DROP INDEX IF EXISTS "IDX_${tabla}_perceptual_hash"`);
      await q.query(
        `ALTER TABLE IF EXISTS "${tabla}" DROP COLUMN IF EXISTS "perceptual_hash"`,
      );
    }
    await q.query(`DROP INDEX IF EXISTS "IDX_property_is_sample"`);
    await q.query(`
      ALTER TABLE "property" DROP CONSTRAINT IF EXISTS "CHK_property_sample_is_draft"`);
    await q.query(`ALTER TABLE "property" DROP COLUMN IF EXISTS "is_sample"`);
    await q.query(`DROP TABLE IF EXISTS "image_album_analysis"`);
    await q.query(`DROP TABLE IF EXISTS "image_analysis"`);
    await q.query(`DROP TABLE IF EXISTS "image_prompt"`);
    await q.query(`DROP TABLE IF EXISTS "image_gate_settings"`);
    await q.query(`DROP TYPE IF EXISTS "image_room_kind_enum"`);
    await q.query(`DROP TYPE IF EXISTS "image_gate_profile_enum"`);
  }
}
