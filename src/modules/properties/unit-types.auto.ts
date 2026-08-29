import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Property } from './domain/property.entity';
import { UnitType, UnitTypeKind } from './domain/unit-type.entity';
import { esSuelo, etiquetaTramo, TOLERANCIA_SUELO } from './domain/land';

/** Un lote con lo justo para decidir en qué tipología cae. */
interface Suelo {
  id: string;
  familyId: string | null;
  unitTypeId: string | null;
  propertyTypeId: number;
  tipo: string;
  area: number | null;
}

/** Una tipología automática con el tramo que ocupan sus lotes de verdad. */
interface Tramo {
  id: string;
  code: string;
  min: number | null;
  max: number | null;
  unidades: number;
}

/**
 * La tipología de los lotes se la pone el sistema.
 *
 * Un edificio tiene "Tipo A" porque alguien lo dibujó así; un terreno no. No
 * hay dos lotes iguales, de modo que escribir una tipología por lote seria
 * escribir una por inmueble, y meterlos todos juntos seria no clasificar nada.
 * Lo unico que los separa es la magnitud: quien busca 600 m² mira igual uno de
 * 800, y descarta el de 1.400.
 *
 * Hasta ahora esto solo lo hacia la migración, una vez. Eso dejaba el sistema
 * muerto: el primer lote que la agencia diera de alta despues se quedaba sin
 * tipología para siempre, porque no habia nada que volviera a mirarlo. Por eso
 * esto corre al guardar el inmueble y no detras de un boton que alguien tenga
 * que acordarse de pulsar.
 *
 * Toca dos tipologías como mucho —la que deja y la que coge— y nunca recalcula
 * el proyecto entero: guardar un lote no puede renombrarle los demas a nadie.
 */
@Injectable()
export class AutoUnitTypesService {
  private readonly logger = new Logger(AutoUnitTypesService.name);

  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
  ) {}

  /**
   * Recoloca el inmueble en la tipología automática que le toca por su área.
   *
   * Se llama despues de guardar, con el inmueble ya en su estado final. Si algo
   * falla, se queda en el registro y no tumba el guardado: la agencia acaba de
   * escribir un inmueble y perderlo por no saber clasificarlo seria peor que
   * dejarlo un rato sin tipología.
   */
  async sync(propertyId: string): Promise<void> {
    try {
      await this.properties.manager.transaction((manager) =>
        this.recolocar(manager, propertyId),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo asignar la tipología automática de ${propertyId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Suelta la tipología que un inmueble deja atras al retirarse.
   *
   * `sync` no puede hacerlo: el inmueble ya esta borrado y no se le puede
   * preguntar de donde venia. Es seguro con las escritas a mano — solo borra
   * las automaticas — y no hace nada si la tipología aun tiene lotes.
   */
  async release(unitTypeId: string | null): Promise<void> {
    if (!unitTypeId) return;
    try {
      await this.properties.manager.transaction((manager) =>
        this.recoger(manager, unitTypeId),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo recoger la tipología automática ${unitTypeId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async recolocar(
    manager: EntityManager,
    propertyId: string,
  ): Promise<void> {
    const [inmueble] = await this.sql<Suelo>(
      manager,
      `SELECT p.id, p.family_id AS "familyId", p.unit_type_id AS "unitTypeId",
              p.property_type_id AS "propertyTypeId", pt.name AS tipo,
              p.area::float AS area
       FROM property p
       JOIN property_type pt ON pt.id = p.property_type_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [propertyId],
    );

    // Borrado o inexistente: solo queda recoger la tipología que deja vacia.
    if (!inmueble) return;

    const previa = inmueble.unitTypeId;

    if (!inmueble.familyId || !esSuelo(inmueble.tipo)) {
      /*
        Dejo de ser suelo o salio del proyecto. Si lo que tenia era automatico,
        deja de tener sentido; si era escrito a mano, se respeta: un lote al que
        la agencia le puso "Parcela esquinera" no lo deshace un guardado.
      */
      if (previa && (await this.esAuto(manager, previa))) {
        await manager.update(
          Property,
          { id: propertyId },
          { unitTypeId: null },
        );
        await this.recoger(manager, previa);
      }
      return;
    }

    // La agencia manda sobre el algoritmo: una tipología escrita no se toca.
    if (previa && !(await this.esAuto(manager, previa))) return;

    const tramos = await this.tramosDe(manager, inmueble);
    const destino =
      this.encaja(tramos, inmueble.area, previa) ??
      (await this.abrir(manager, inmueble));

    if (destino !== previa) {
      await manager.update(
        Property,
        { id: propertyId },
        { unitTypeId: destino },
      );
      if (previa) await this.recoger(manager, previa);
    }
    await this.reajustar(manager, destino, inmueble.tipo);
  }

  /**
   * La tipología cuyo tramo admite esta área.
   *
   * Cabe si, metiendo el lote dentro, el grupo entero sigue sin estirarse mas
   * del 40% desde su menor. Se mira asi —y no contra el tramo escrito— para que
   * dé igual el orden en que se hayan ido dando de alta los lotes.
   *
   * Con varias posibles gana la que mas lotes tiene, aunque el inmueble venga
   * de otra. Si ganara la suya, un lote de 5.500 m² que se corrige a 1.100 se
   * quedaria solo en su tipología de uno mientras hay nueve mas de 1.100 al
   * lado: dos tipologías para el mismo tramo, y un desplegable que ofrece dos
   * veces lo mismo. El desempate va por la menor, y luego por la que ya tenia,
   * para que dos guardados seguidos no lo muevan de un lado a otro.
   */
  private encaja(
    tramos: Tramo[],
    area: number | null,
    previa: string | null,
  ): string | null {
    // Un lote sin área no se puede comparar con ninguno: van juntos y aparte.
    const candidatos = tramos.filter((tramo) =>
      area === null || area <= 0
        ? tramo.min === null
        : tramo.min !== null &&
          Math.max(tramo.max ?? 0, area) <=
            Math.min(tramo.min, area) * (1 + TOLERANCIA_SUELO),
    );

    return (
      candidatos.sort(
        (a, b) =>
          b.unidades - a.unidades ||
          (a.min ?? 0) - (b.min ?? 0) ||
          Number(b.id === previa) - Number(a.id === previa),
      )[0]?.id ?? null
    );
  }

  /** Los tramos automaticos del proyecto para ESTE tipo de inmueble. */
  private async tramosDe(
    manager: EntityManager,
    inmueble: Suelo,
  ): Promise<Tramo[]> {
    /*
      El tipo de inmueble no esta en `unit_type`: sale de sus propias unidades,
      que es donde vive de verdad —una tipología automatica no puede tener lotes
      y fincas mezclados, porque nace de ellos—. Asi no hace falta una columna
      que habria que mantener a mano y que se podria contradecir con los datos.
    */
    return this.sql<Tramo>(
      manager,
      `SELECT ut.id, ut.code,
              MIN(p.area)::float AS min, MAX(p.area)::float AS max,
              COUNT(p.id)::int AS unidades
       FROM unit_type ut
       JOIN property p ON p.unit_type_id = ut.id AND p.deleted_at IS NULL
       WHERE ut.family_id = $1
         AND ut.kind = 'AUTO'
         AND p.property_type_id = $2
       GROUP BY ut.id, ut.code`,
      [inmueble.familyId, inmueble.propertyTypeId],
    );
  }

  /** Abre una tipología nueva para un lote que no cabe en ninguna. */
  private async abrir(
    manager: EntityManager,
    inmueble: Suelo,
  ): Promise<string> {
    const [{ code, position }] = await this.sql<{
      code: string;
      position: number;
    }>(
      manager,
      `SELECT 'L' || (COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1) AS code,
              COALESCE(MAX(position), -1) + 1 AS position
       FROM unit_type
       WHERE family_id = $1 AND kind = 'AUTO'`,
      [inmueble.familyId],
    );

    const area = inmueble.area && inmueble.area > 0 ? inmueble.area : null;
    const [creada] = await this.sql<{ id: string }>(
      manager,
      `INSERT INTO unit_type
         ("family_id", "code", "name", "kind", "area_min", "area_max", "position")
       VALUES ($1, $2, $3, 'AUTO', $4, $4, $5)
       RETURNING id`,
      [
        inmueble.familyId,
        code,
        `${inmueble.tipo} ${etiquetaTramo(area, area)}`.slice(0, 160),
        area,
        position,
      ],
    );

    return creada.id;
  }

  /**
   * Pone el tramo y el nombre al dia con los lotes que tiene dentro.
   *
   * Se hace tambien al quitar uno: si se va el lote de 1.400 m², la tipología
   * no puede seguir anunciandose "hasta 1.400".
   */
  private async reajustar(
    manager: EntityManager,
    unitTypeId: string,
    tipo: string,
  ): Promise<void> {
    const [tramo] = await this.sql<{
      min: number | null;
      max: number | null;
    }>(
      manager,
      `SELECT MIN(p.area)::float AS min, MAX(p.area)::float AS max
       FROM property p
       WHERE p.unit_type_id = $1 AND p.deleted_at IS NULL`,
      [unitTypeId],
    );

    await manager.query(
      `UPDATE unit_type
       SET area_min = $2, area_max = $3, name = $4
       WHERE id = $1 AND kind = 'AUTO'`,
      [
        unitTypeId,
        tramo?.min ?? null,
        tramo?.max ?? null,
        `${tipo} ${etiquetaTramo(tramo?.min ?? null, tramo?.max ?? null)}`.slice(
          0,
          160,
        ),
      ],
    );
  }

  /**
   * Borra la tipología automatica que se ha quedado sin lotes.
   *
   * Una tipología vacia que nadie escribio es un fantasma: ocupa sitio en el
   * panel, sale en el desplegable de la web y no lleva a ningun inmueble. Las
   * escritas a mano no se tocan — esas existen aunque no tengan unidades
   * todavia, que es justo lo que pasa mientras se dan de alta.
   */
  private async recoger(
    manager: EntityManager,
    unitTypeId: string,
  ): Promise<void> {
    const [{ unidades }] = await this.sql<{ unidades: number }>(
      manager,
      `SELECT COUNT(*)::int AS unidades FROM property
       WHERE unit_type_id = $1 AND deleted_at IS NULL`,
      [unitTypeId],
    );

    if (unidades > 0) {
      const [tipo] = await this.sql<{ tipo: string }>(
        manager,
        `SELECT pt.name AS tipo FROM property p
         JOIN property_type pt ON pt.id = p.property_type_id
         WHERE p.unit_type_id = $1 AND p.deleted_at IS NULL LIMIT 1`,
        [unitTypeId],
      );
      if (tipo) await this.reajustar(manager, unitTypeId, tipo.tipo);
      return;
    }

    await manager.delete(UnitType, { id: unitTypeId, kind: UnitTypeKind.AUTO });
  }

  /**
   * `query` devuelve `any`, y con `any` el compilador deja de mirar. Se acota
   * aqui, en un sitio, en vez de repartir aserciones por cada consulta.
   */
  private async sql<T>(
    manager: EntityManager,
    query: string,
    params: unknown[],
  ): Promise<T[]> {
    const filas: unknown = await manager.query(query, params);
    return filas as T[];
  }

  private async esAuto(
    manager: EntityManager,
    unitTypeId: string,
  ): Promise<boolean> {
    const tipologia = await manager.findOne(UnitType, {
      where: { id: unitTypeId },
      select: { id: true, kind: true },
      loadEagerRelations: false,
    });
    return tipologia?.kind === UnitTypeKind.AUTO;
  }
}
