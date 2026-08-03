import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La jornada pasa de un tramo por dia a varios.
 *
 * El horario real de la agencia tiene pausa de mediodia —de 8 a 12 y de 2 a 6—
 * y con un solo tramo no cabia: o se dejaba abierto el almuerzo, y la web
 * ofrecia visitas a la una, o se perdia media tarde.
 *
 * Se convierte lo que hubiera guardado en lugar de sobrescribirlo: si alguien
 * ya habia ajustado sus horas desde el panel, se conservan como un tramo.
 */
export class SplitWorkdays1785722819924 implements MigrationInterface {
  name = 'SplitWorkdays1785722819924';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE booking_settings
      SET workdays = (
        SELECT jsonb_agg(
          jsonb_build_object(
            'weekday', dia->'weekday',
            'open', dia->'open',
            'ranges', COALESCE(
              dia->'ranges',
              jsonb_build_array(
                jsonb_build_object('from', dia->>'from', 'to', dia->>'to')
              )
            )
          )
        )
        FROM jsonb_array_elements(workdays) AS dia
      )
      WHERE jsonb_typeof(workdays) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(workdays) AS d
          WHERE d ? 'from'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE booking_settings
      SET workdays = (
        SELECT jsonb_agg(
          jsonb_build_object(
            'weekday', dia->'weekday',
            'open', dia->'open',
            'from', dia->'ranges'->0->>'from',
            'to', dia->'ranges'->-1->>'to'
          )
        )
        FROM jsonb_array_elements(workdays) AS dia
      )
      WHERE jsonb_typeof(workdays) = 'array'
    `);
  }
}
