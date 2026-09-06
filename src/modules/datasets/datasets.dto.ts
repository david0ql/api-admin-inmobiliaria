import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Como viajan las filas.
 *
 * `filas` manda arrays paralelos a `columns`; `objetos` manda un objeto por
 * fila. La diferencia no es de gusto: con 7.532 clientes y veinte columnas, el
 * formato de objetos repite veinte nombres de campo siete mil quinientas veces
 * y eso son megabytes de nombres de columna. La rejilla ademas quiere una
 * matriz, asi que `filas` es lo que se sirve por defecto.
 */
export enum FormatoHoja {
  FILAS = 'filas',
  OBJETOS = 'objetos',
}

/** Tope duro: por encima de esto no se sirve ni pidiendolo. */
export const TOPE_MAXIMO = 20_000;

/** Lo que se devuelve si no se pide otra cosa. Los 642 inmuebles caben; los
 *  7.532 clientes tambien, y el resto se pagina con `offset`. */
export const TOPE_POR_DEFECTO = 10_000;

export class DatasetQueryDto {
  @ApiPropertyOptional({
    enum: FormatoHoja,
    default: FormatoHoja.FILAS,
    description:
      'filas = arrays paralelos a columns; objetos = un objeto por fila',
  })
  @IsOptional()
  @IsEnum(FormatoHoja, {
    message: 'El formato debe ser «filas» u «objetos»',
  })
  format?: FormatoHoja;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: TOPE_MAXIMO,
    default: TOPE_POR_DEFECTO,
    description: 'Filas por peticion. Si se queda corto, `truncated` lo avisa.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TOPE_MAXIMO, {
    message: `Una hoja no sirve más de ${TOPE_MAXIMO} filas por petición: usa «offset» para pedir la siguiente página`,
  })
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description: 'Desde que fila. Con `total` basta para recorrerlo todo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
