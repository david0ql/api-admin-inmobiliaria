import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una tipologia puede tener precio y unidades propios.
 *
 * Hasta ahora toda la economia de un proyecto se DERIVABA de sus inmuebles: el
 * "desde $X", las unidades disponibles y las areas salian de un GROUP BY sobre
 * `property`. Eso funciona para lo que hay hoy —edificios entregados cuyas
 * unidades se venden de una en una— y hace imposible lo que la agencia quiere
 * empezar a hacer: vender obra nueva.
 *
 * Para anunciar una torre de 120 apartamentos sobre planos habria que dar de
 * alta 120 fichas de inmueble, cada una con sus cuarenta y pico campos, sus
 * fotos y su asesor. Nadie hace eso. Lo que se anuncia es "Tipo A, 58 m², 2
 * alcobas, desde $320.000.000, quedan 14" — cuatro tipologias y ya.
 *
 * Con estas columnas, una tipologia se sostiene sola. Se mantiene la regla que
 * ya regia para las areas: MANDA LO ESCRITO, y solo si no hay nada escrito se
 * cae a lo que digan las unidades. Asi los 57 conjuntos de hoy siguen
 * comportandose exactamente igual —no tienen nada escrito— y los proyectos
 * nuevos no necesitan inventar inmuebles para existir.
 */
export class TypologyCommercials1788400000000 implements MigrationInterface {
  name = 'TypologyCommercials1788400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "unit_type" ADD COLUMN "price_from" numeric(14,2) NULL`,
    );
    await q.query(
      `ALTER TABLE "unit_type" ADD COLUMN "price_to" numeric(14,2) NULL`,
    );
    await q.query(
      `ALTER TABLE "unit_type" ADD COLUMN "units_total" integer NULL`,
    );
    await q.query(
      `ALTER TABLE "unit_type" ADD COLUMN "units_available" integer NULL`,
    );
    /*
      Que no se pueda escribir un disparate: mas disponibles que totales, o un
      precio "desde" mayor que el "hasta". Son los dos errores que se cometen
      tecleando, y en una ficha publica se leen como una mentira.
    */
    await q.query(
      `ALTER TABLE "unit_type" ADD CONSTRAINT "ck_unit_type_units"
       CHECK ("units_available" IS NULL OR "units_total" IS NULL OR "units_available" <= "units_total")`,
    );
    await q.query(
      `ALTER TABLE "unit_type" ADD CONSTRAINT "ck_unit_type_precio"
       CHECK ("price_from" IS NULL OR "price_to" IS NULL OR "price_from" <= "price_to")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "unit_type" DROP CONSTRAINT IF EXISTS "ck_unit_type_precio"`,
    );
    await q.query(
      `ALTER TABLE "unit_type" DROP CONSTRAINT IF EXISTS "ck_unit_type_units"`,
    );
    await q.query(`ALTER TABLE "unit_type" DROP COLUMN "units_available"`);
    await q.query(`ALTER TABLE "unit_type" DROP COLUMN "units_total"`);
    await q.query(`ALTER TABLE "unit_type" DROP COLUMN "price_to"`);
    await q.query(`ALTER TABLE "unit_type" DROP COLUMN "price_from"`);
  }
}
