import type { ValueTransformer } from 'typeorm';

/**
 * Postgres devuelve `numeric` como string para no perder precision. Para precios
 * y areas trabajamos con `number` en la capa de aplicacion; los valores del
 * inmobiliario colombiano (miles de millones de COP) caben de sobra en un double.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : Number(value),
};
