import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Que le paso a los ficheros que mando el propietario y no estan en la ficha.
 *
 * Hasta ahora, cuando una foto no pasaba la puerta o cuando fallaba el guardado
 * de un documento, el fichero se descartaba y no quedaba constancia de nada: ni
 * el nombre ni el motivo. El propietario creia haber mandado la escritura, el
 * asesor no sabia que faltaba, y la solicitud quedaba coja sin que ninguno de
 * los dos pudiera enterarse. La unica forma de descubrirlo era que alguien
 * cruzara los dos lados por casualidad.
 *
 * Esta columna guarda el hecho. Es una lista de objetos y no un texto porque el
 * panel pinta el nombre del fichero y el motivo por separado, y partir la
 * cadena `"nombre.jpg": motivo` se rompe con cualquier nombre que lleve
 * comillas o dos puntos — que los llevan, porque los suben desde el movil.
 *
 * Va aparte de `notes`, que es el mensaje que escribio el propietario y que el
 * panel ya enseña como "Observaciones del propietario": escribir aqui los
 * avisos tecnicos le pisaria lo suyo.
 */
export class ConsignmentFileNotes1786800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "consignment_request"
        ADD COLUMN "file_notes" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "consignment_request" DROP COLUMN IF EXISTS "file_notes"`);
  }
}
