import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un inmueble suelto es USADO; una unidad de proyecto es obra nueva.
 *
 * Hasta ahora las dos cosas vivian en la misma tabla sin nada que las
 * distinguiera salvo tener o no `family_id`, y el resultado es el que se
 * esperaria: de las 193 unidades de proyecto, 153 estaban marcadas como
 * "usado". Nadie mentia — es que la columna `condition` describe un inmueble
 * de segunda mano y a una unidad sobre planos no se le aplica, asi que se
 * quedaba con el valor por defecto.
 *
 * Eso tiene consecuencias que se ven fuera: la web publica ofrece filtrar por
 * "Nuevo" o "Usado", y un apartamento sobre planos de una constructora salia
 * en "Usado". Y al reves: quien busca usado se llevaba obra nueva.
 *
 * Se añade `kind`, que dice QUE ES cada fila, y una restriccion que impide que
 * vuelvan a mezclarse: una unidad de proyecto tiene proyecto, y un usado no lo
 * tiene. No es una convencion que haya que recordar, es una regla de la base.
 *
 * Esto NO separa todavia las dos cosas en tablas distintas. Mover las 193
 * unidades arrastra 9.042 filas dependientes —4.595 caracteristicas, 1.974
 * publicaciones en portales, 1.603 fotos, 656 intereses de clientes, 193
 * asignaciones, 20 analisis de imagen y una cita— y eso pide su propia ventana.
 * Lo que si se arregla hoy es el dato y la regla.
 */
export class ProjectUnits1788200000000 implements MigrationInterface {
  name = 'ProjectUnits1788200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "property_kind_enum" AS ENUM('USED','PROJECT_UNIT')`,
    );
    await q.query(
      `ALTER TABLE "property" ADD COLUMN "kind" "property_kind_enum" NOT NULL DEFAULT 'USED'`,
    );

    // Lo que cuelga de un proyecto es una unidad de proyecto. Sin excepciones.
    await q.query(
      `UPDATE "property" SET "kind" = 'PROJECT_UNIT' WHERE "family_id" IS NOT NULL`,
    );

    /*
      Y su condicion es NUEVA, porque eso es lo que es: una unidad que entrega
      una constructora. Se corrigen las 153 que decian "usado" y las 17 que
      decian "proyecto" —un valor que la web ya no ofrece desde que el filtro
      se redujo a Nuevo y Usado, y que por tanto no casaba con nada—.
    */
    await q.query(
      `UPDATE "property" SET "condition" = 'NEW' WHERE "kind" = 'PROJECT_UNIT' AND "condition" <> 'NEW'`,
    );

    await q.query(
      `ALTER TABLE "property" ADD CONSTRAINT "ck_property_kind_family"
       CHECK (
         ("kind" = 'PROJECT_UNIT' AND "family_id" IS NOT NULL)
         OR ("kind" = 'USED' AND "family_id" IS NULL)
       )`,
    );
    await q.query(`CREATE INDEX "idx_property_kind" ON "property" ("kind")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_property_kind"`);
    await q.query(
      `ALTER TABLE "property" DROP CONSTRAINT IF EXISTS "ck_property_kind_family"`,
    );
    await q.query(`ALTER TABLE "property" DROP COLUMN "kind"`);
    await q.query(`DROP TYPE "property_kind_enum"`);
    // La condicion corregida no se revierte: el dato nuevo es el correcto.
  }
}
