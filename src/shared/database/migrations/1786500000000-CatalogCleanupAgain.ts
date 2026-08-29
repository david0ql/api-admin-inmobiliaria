import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La homologacion de catalogos, otra vez, porque el sembrado la deshizo.
 *
 * `yarn seed` actualizaba los catalogos por clave primaria con los valores del
 * volcado de WASI. Una ejecucion contra la base viva devolvio el ruido entero:
 * los municipios perdieron las tildes, 'Ph', 'Terreno' y 'Piso' volvieron al
 * selector, y 'Ruitoque Resort' volvio a estar cinco veces. Nada fallo, porque
 * un upsert no falla nunca; se vio contando filas.
 *
 * Esta migracion repite lo que hizo `CatalogCleanup1786300000000`. No basta con
 * volver a marcarla como pendiente: una migracion ejecutada es un hecho del
 * pasado y reescribirlo deja la base y el registro contando historias
 * distintas.
 *
 * La causa esta arreglada en el mismo cambio: el sembrado ya solo inserta lo
 * que falta y no toca lo que existe. Sin eso, esto volveria a hacer falta cada
 * vez que alguien ejecute `yarn seed`.
 *
 * Todo lo de aqui es idempotente —renombrar a lo que ya deberia ser, dar de
 * baja lo que ya deberia estar de baja— asi que correrla sobre una base sana
 * no cambia nada.
 */
const ENLACES = ['de', 'del', 'y'];

/** "Cabecera Del Llano" -> "Cabecera del Llano". La primera palabra no se toca. */
function minusculizar(nombre: string): string {
  return nombre
    .split(' ')
    .map((palabra, i) =>
      i > 0 && ENLACES.includes(palabra.toLowerCase())
        ? palabra.toLowerCase()
        : palabra,
    )
    .join(' ');
}

/** El inverso, para el down(). */
function mayusculizar(nombre: string): string {
  return nombre
    .split(' ')
    .map((palabra, i) =>
      i > 0 && ENLACES.includes(palabra.toLowerCase())
        ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
        : palabra,
    )
    .join(' ');
}

export class CatalogCleanupAgain1786500000000 implements MigrationInterface {
  /** Reescribe los nombres de zona que cambian al aplicarles `regla`. */
  private async recasearZonas(
    q: QueryRunner,
    regla: (nombre: string) => string,
  ): Promise<void> {
    const zonas = (await q.query(`SELECT "id", "name" FROM "zone"`)) as {
      id: number;
      name: string;
    }[];
    for (const zona of zonas) {
      const nuevo = regla(zona.name);
      if (nuevo === zona.name) continue;
      await q.query(`UPDATE "zone" SET "name" = $1 WHERE "id" = $2`, [
        nuevo,
        zona.id,
      ]);
    }
  }

  public async up(q: QueryRunner): Promise<void> {
    // --- Tipos de inmueble ---------------------------------------------

    await q.query(
      `UPDATE "property_type" SET "name" = 'Galpón Industrial' WHERE "id" = 23`,
    );

    /*
      Los cuatro que se dan de baja no tienen inmuebles (comprobado antes de
      escribir esto), asi que no hay nada que reasignar: basta con sacarlos
      del selector. Se marcan en vez de borrarse porque `property` los
      referencia por clave ajena y porque un dia pueden volver a hacer falta.

        34  models/property_type.id.34 -> basura del volcado
        33  Ph                         -> es 21 'Penthouse'
        32  Terreno                    -> es 5 'Lote / Terreno'
        25  Piso                       -> es 2 'Apartamento' (termino de España)
    */
    await q.query(
      `UPDATE "property_type" SET "active" = false WHERE "id" IN (25, 32, 33, 34)`,
    );

    // --- Municipios -----------------------------------------------------

    /*
      Tildes y mayusculas de los municipios de Santander. Ninguno tiene
      inmuebles todavia, pero todos salen en el selector de alta y en el
      buscador del asistente.
    */
    const municipios: [number, string][] = [
      [149, 'Carcasí'],
      [184, 'Chipatá'],
      [363, 'Guavatá'],
      [368, 'Güepsa'],
      [400, 'Jesús María'],
      [477, 'Málaga'],
      [579, 'Palmas del Socorro'],
      [588, 'Páramo'],
      [695, 'Sabana de Torres'],
      [817, 'Simacota'],
      [945, 'Vélez'],
      [1099, 'Bolívar'],
      [1105, 'Florián'],
      [1110, 'Santa Bárbara'],
      // 'El Carmen' a secas no existe en Santander: es El Carmen de Chucuri.
      [1102, 'El Carmen de Chucurí'],
    ];
    for (const [id, name] of municipios) {
      await q.query(`UPDATE "city" SET "name" = $1 WHERE "id" = $2`, [
        name,
        id,
      ]);
    }

    /*
      Dos municipios entraron dos veces con el nombre a medias. Ninguno de los
      cuatro tiene zonas, inmuebles, clientes ni proyectos, asi que el
      sobrante se borra en vez de quedarse ensuciando el desplegable.

        1109 'San Vicente' -> ya existe 774 'San Vicente de Chucurí'
        1103 'Guacamayo'   -> ya existe 273 'El Guacamayo'
    */
    await q.query(`DELETE FROM "city" WHERE "id" IN (1103, 1109)`);

    // --- Zonas ----------------------------------------------------------

    /*
      'Ruitoque Resort' esta cinco veces en Giron, con cinco ids distintos y
      cero inmuebles en las cinco. Se conserva la primera (823695) porque es
      la de id mas bajo y por tanto la que el volcado creo primero.
    */
    await q.query(
      `DELETE FROM "zone" WHERE "id" IN (823696, 823697, 823698, 823699)`,
    );

    const zonas: [number, string][] = [
      [512413, 'Alarcón'],
      [512395, 'Alfonso López'],
      [512755, 'Álvarez'],
      [517212, 'Bolívar'],
      [583665, 'Gaitán'],
      [512431, 'García Rovira'],
      [512374, 'Mejoras Públicas'],
      [512407, 'Pan de Azúcar'],
      [733104, 'San Martín'],
      [512392, 'Abadías'],
      [517190, 'Fátima'],
      [590662, 'Río Frío'],
      [590681, 'San Nicolás'],
      [818879, 'Portal de Río Frío'],
      [861810, 'Rincón de Girón'],
      [904585, 'Los Cámbulos'],
      [823707, 'Villa Sofía'],
      [700627, 'Junín'],
      [751610, 'San Cristóbal'],
      [389914, 'Guatiguará'],
      [970298, 'Vía Palonegro'],
      [541871, 'Río del Hato'],
    ];
    for (const [id, name] of zonas) {
      await q.query(`UPDATE "zone" SET "name" = $1 WHERE "id" = $2`, [
        name,
        id,
      ]);
    }

    /*
      El volcado escribio todas las zonas en Title Case a la inglesa: "Cabecera
      Del Llano", "Pan De Azucar", "Mesa De Los Santos". En castellano los
      enlaces van en minuscula salvo cuando abren el nombre.

      Se recorre en TypeScript y no con un regexp_replace porque la sustitucion
      necesita bajar a minuscula lo que ha capturado, y en el reemplazo de
      Postgres `\1` es texto literal: `lower('\1')` bajaria la cadena "\1", no
      la palabra. Ademas asi la lista de nombres afectados se ve en el log de
      la migracion.
    */
    await this.recasearZonas(q, minusculizar);

    // --- Caracteristicas -------------------------------------------------

    const caracteristicas: [number, string][] = [
      [9, 'Hall de alcobas'], // llevaba dos espacios
      [46, 'Urbanización cerrada'], // llevaba dos espacios
      [138, 'Bahías de parqueo'],
      [63, 'Cancha de fútbol'],
      [135, 'Energía solar'],
      [45, 'Circuito cerrado de TV'],
      [54, 'Bosques nativos'],
    ];
    for (const [id, name] of caracteristicas) {
      await q.query(`UPDATE "feature" SET "name" = $1 WHERE "id" = $2`, [
        name,
        id,
      ]);
    }

    // --- Titulos de los inmuebles ----------------------------------------

    /*
      23 titulos traen dobles espacios de teclear a mano ("EN VENTA EN
      GUAYACAN"). Un espacio de mas parte el nombre del conjunto al comparar
      titulos, que es justo lo que las tipologias necesitan comparar.
    */
    await q.query(`
      UPDATE "property"
      SET "title" = trim(regexp_replace("title", '\\s+', ' ', 'g'))
      WHERE "title" <> trim(regexp_replace("title", '\\s+', ' ', 'g'))
    `);

    /*
      Y a 7 les falta el "EN" que separa la operacion del conjunto:
      "APARTAMENTO EN VENTA BALMORAL" en vez de "... EN VENTA EN BALMORAL".
      La guarda del WHERE deja fuera los que ya lo tienen bien, incluido el
      unico titulo al que ademas le falta el tipo de inmueble delante
      (codigo 10141907), que se queda como esta porque completar ese hueco ya
      seria inventar.
    */
    await q.query(`
      UPDATE "property"
      SET "title" = regexp_replace("title", ' EN (VENTA|ARRIENDO) ', ' EN \\1 EN ')
      WHERE "title" ~ ' EN (VENTA|ARRIENDO) '
        AND "title" !~ ' EN (VENTA|ARRIENDO) EN '
    `);
  }

  /*
    Sin down(): esto repara, no cambia el diseño. Deshacerlo seria volver a
    escribir mal los nombres a proposito.
  */
  public async down(): Promise<void> {}
}
