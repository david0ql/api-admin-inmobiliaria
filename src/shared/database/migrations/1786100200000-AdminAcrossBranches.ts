import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El administrador de la empresa, sin sede.
 *
 * `admin@serrano-inmobiliaria.com` figuraba como AGENT: el ADMIN de la
 * instalacion era la cuenta de Javier, que ahora coordina Bucaramanga. Sin
 * este paso el sistema se queda sin nadie que pueda abrir una sede o nombrar
 * un coordinador, que es justo lo que multisede necesita para arrancar.
 *
 * Sin sede a proposito: quien las ve todas no pertenece a ninguna.
 */
export class AdminAcrossBranches1786100200000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "agent" SET "role" = 'ADMIN', "branch_id" = NULL
       WHERE lower("email") = 'admin@serrano-inmobiliaria.com'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "agent" SET "role" = 'AGENT'
       WHERE lower("email") = 'admin@serrano-inmobiliaria.com'`,
    );
  }
}
