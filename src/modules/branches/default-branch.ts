import { InternalServerErrorException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * La sede que recoge lo que entra desde fuera.
 *
 * Un visitante de la web, un registro del portal o un lead del chat no tienen
 * sesion y por tanto no traen sede, pero el cliente que se crea con ellos si la
 * necesita: la columna es NOT NULL porque una ficha sin oficina no la ve nadie
 * y se queda sin llamar. Cae en la principal, y desde ahi se reparte.
 *
 * Se resuelve por consulta y no por configuracion para no tener el mismo dato
 * en dos sitios: la marca `is_default` de la tabla es la unica verdad, y la
 * migracion garantiza que hay exactamente una.
 */
let memoria: string | null = null;

export async function defaultBranchId(manager: EntityManager): Promise<string> {
  // La sede principal no cambia en caliente —marcarla es una decision de
  // instalacion—, asi que se recuerda y no se pregunta en cada alta.
  if (memoria) return memoria;

  const filas = await manager.query<{ id: string }[]>(
    `SELECT id FROM "branch" WHERE is_default = true LIMIT 1`,
  );

  const id = filas[0]?.id;
  if (!id) {
    throw new InternalServerErrorException(
      'No hay ninguna sede marcada como principal: los registros que llegan de fuera no tienen dónde caer',
    );
  }
  memoria = id;
  return id;
}
