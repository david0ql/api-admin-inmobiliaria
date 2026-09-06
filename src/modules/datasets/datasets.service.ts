import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { DatasetQueryDto, FormatoHoja, TOPE_POR_DEFECTO } from './datasets.dto';
import {
  ColumnaPublica,
  DefinicionHoja,
  HOJAS,
  NOMBRES_HOJA,
  hojaPorNombre,
} from './hojas';

/** La ficha de una hoja en el catalogo: lo que hay, sin traerse las filas. */
export interface FichaHoja {
  nombre: string;
  titulo: string;
  descripcion: string;
  columns: ColumnaPublica[];
  /** Cuantas filas veria QUIEN PREGUNTA, ya acotado por sede y por rol. */
  total: number;
}

export interface HojaServida {
  dataset: string;
  titulo: string;
  descripcion: string;
  columns: ColumnaPublica[];
  format: FormatoHoja;
  /** Arrays paralelos a `columns`, u objetos, segun `format`. */
  rows: unknown[][] | Record<string, unknown>[];
  /** Filas de ESTA respuesta. */
  count: number;
  /** Filas que hay en total dentro del alcance de quien pregunta. */
  total: number;
  offset: number;
  /** Quedan filas sin servir: la hoja esta incompleta. */
  truncated: boolean;
  /** El `offset` de la siguiente pagina, o nulo si no hay mas. */
  nextOffset: number | null;
  generatedAt: string;
}

/**
 * Las hojas de datos que alimentan la vista de hoja de calculo.
 *
 * Todo lo de aqui es de SOLO LECTURA. La hoja es una capa de analisis: lo que
 * el usuario monte encima —formulas, tablas dinamicas, columnas suyas— es
 * volatil y no vuelve al CRM por ninguna via.
 *
 * El acotado por sede y por asesor se aplica SIEMPRE en el QueryBuilder de cada
 * hoja (ver `hojas.ts`) y nunca filtrando en memoria. Es lo mas facil de romper
 * en un sitio como este: una consulta cruda para "sacarlo todo de golpe" se
 * salta el acotado sin que salte ninguna alarma, y un coordinador acabaria
 * abriendo la hoja con el inventario y los telefonos de otra oficina.
 */
@Injectable()
export class DatasetsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Que hojas hay, con sus columnas y cuantas filas tiene cada una. */
  async catalogo(actor: AuthenticatedActor): Promise<FichaHoja[]> {
    return Promise.all(
      HOJAS.map(async (hoja) => ({
        nombre: hoja.nombre,
        titulo: hoja.titulo,
        descripcion: hoja.descripcion,
        columns: this.columnasPublicas(hoja),
        total: await this.total(hoja, actor),
      })),
    );
  }

  /** Una hoja, ya paginada y en el formato que se pida. */
  async hoja(
    nombre: string,
    dto: DatasetQueryDto,
    actor: AuthenticatedActor,
  ): Promise<HojaServida> {
    const hoja = hojaPorNombre(nombre);
    if (!hoja) {
      throw new NotFoundException(
        `No existe la hoja «${nombre}». Las que hay son: ${NOMBRES_HOJA.join(', ')}`,
      );
    }

    const format = dto.format ?? FormatoHoja.FILAS;
    const limit = dto.limit ?? TOPE_POR_DEFECTO;
    const offset = dto.offset ?? 0;

    const total = await this.total(hoja, actor);

    const qb = hoja.consulta(this.ds, actor);
    /*
      `select` en vez de `addSelect`: la consulta nace de un repositorio y por
      tanto trae seleccionadas todas las columnas de su entidad. Sin vaciar esa
      seleccion viajarian tambien las que la hoja no pide —observaciones,
      geometria, notas— y ademas se colarian columnas que no deberian salir de
      su modulo.
    */
    qb.select(hoja.columnas[0].sql, hoja.columnas[0].key);
    for (const col of hoja.columnas.slice(1)) qb.addSelect(col.sql, col.key);

    /*
      El orden tiene que ser total y estable: con un orden que empata, dos
      paginas consecutivas pueden traer la misma fila dos veces y perderse otra.
      Por eso cada hoja termina su orden por una columna unica.
    */
    for (const [expr, dir] of hoja.orden) qb.addOrderBy(expr, dir);

    const crudas = await qb.offset(offset).limit(limit).getRawMany();

    const rows =
      format === FormatoHoja.FILAS
        ? crudas.map((fila: Record<string, unknown>) =>
            hoja.columnas.map((col) => normaliza(fila[col.key])),
          )
        : crudas.map((fila: Record<string, unknown>) => {
            const objeto: Record<string, unknown> = {};
            for (const col of hoja.columnas)
              objeto[col.key] = normaliza(fila[col.key]);
            return objeto;
          });

    const servidas = offset + rows.length;
    return {
      dataset: hoja.nombre,
      titulo: hoja.titulo,
      descripcion: hoja.descripcion,
      columns: this.columnasPublicas(hoja),
      format,
      rows,
      count: rows.length,
      total,
      offset,
      truncated: servidas < total,
      nextOffset: servidas < total ? servidas : null,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Cuantas filas hay dentro del alcance de quien pregunta.
   *
   * Se cuenta con la MISMA consulta que sirve las filas —el mismo FROM, los
   * mismos joins, el mismo acotado— y no con un `count(*)` escrito aparte:
   * contar por un lado y filtrar por otro es como se acaba enseñando "642
   * inmuebles" a quien solo puede ver doscientos.
   */
  private async total(
    hoja: DefinicionHoja,
    actor: AuthenticatedActor,
  ): Promise<number> {
    const qb = hoja.consulta(this.ds, actor).select('COUNT(*)', 'n');
    const fila = await qb.getRawOne<{ n: string }>();
    return Number(fila?.n ?? 0);
  }

  private columnasPublicas(hoja: DefinicionHoja): ColumnaPublica[] {
    // El SQL de cada columna se queda aqui: es implementacion, y publicarlo
    // seria contarle a cualquiera con un token como esta montada la base.
    return hoja.columnas.map(({ key, label, tipo }) => ({ key, label, tipo }));
  }
}

/**
 * Lo que la celda espera recibir.
 *
 * Las cifras ya vienen casteadas a float8 desde SQL, asi que aqui solo queda
 * una cosa: que un hueco sea `null` y no la cadena vacia. En una hoja de
 * calculo no es lo mismo — `null` no cuenta en un PROMEDIO y `""` puede
 * romperlo.
 */
function normaliza(valor: unknown): unknown {
  return valor === undefined ? null : valor;
}
