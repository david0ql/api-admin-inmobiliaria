import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quien es quien, ahora que hay sedes.
 *
 * Va aparte de la migracion que crea el rol a proposito: Postgres deja añadir
 * un valor a un enum dentro de una transaccion, pero no USARLO hasta que esa
 * transaccion termina. Juntarlas falla con "unsafe use of new value".
 *
 * El reparto:
 *  - El administrador se queda sin sede porque las ve todas. Pertenecer a una
 *    y ver las demas seria una contradiccion que tarde o temprano alguien
 *    codifica mal.
 *  - Javier pasa a coordinar Bucaramanga: es quien lleva la oficina.
 *  - Los MANAGER que hubiera pasan a COORDINATOR, que es el mismo trabajo con
 *    el nombre que ahora significa algo.
 *  - El resto del equipo se queda en Bucaramanga, que es donde ya estaba.
 */
export class BranchRoles1786100100000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const [sede] = (await q.query(
      `SELECT id FROM "branch" WHERE is_default = true LIMIT 1`,
    )) as { id: string }[];
    if (!sede) return;

    await q.query(
      `UPDATE "agent" SET "role" = 'COORDINATOR' WHERE "role" = 'MANAGER'`,
    );

    await q.query(
      `UPDATE "agent" SET "role" = 'COORDINATOR', "branch_id" = $1
       WHERE lower("email") = 'contacto@serrano-inmobiliaria.com'`,
      [sede.id],
    );

    await q.query(
      `UPDATE "agent" SET "branch_id" = NULL
       WHERE "role" IN ('ADMIN', 'DIRECTOR')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "agent" SET "role" = 'MANAGER' WHERE "role" = 'COORDINATOR'`,
    );
  }
}
