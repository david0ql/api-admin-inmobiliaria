/**
 * Normalizadores para parametros de consulta repetidos.
 *
 * Un mismo filtro llega de tres formas segun quien construya la URL:
 * `?typeId=1&typeId=2`, `?typeId=1,2` o `?typeId=1`. Estos helpers unifican los
 * tres casos en un array, y viven aqui porque los usan tanto la busqueda de
 * inmuebles como la de clientes.
 */

/** Los parametros de consulta siempre llegan como texto o array de texto. */
function scalarToString(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parts: string[] = Array.isArray(value)
    ? (value as unknown[]).map(scalarToString)
    : scalarToString(value).split(',');
  return parts.map((v) => v.trim()).filter(Boolean);
}

/** `?id=1,2` o `?id=1&id=2` -> `[1, 2]`, descartando lo que no sea numero. */
export const csvNumbers = ({
  value,
}: {
  value: unknown;
}): number[] | undefined => {
  const parts = toStringArray(value);
  if (!parts) return undefined;
  return parts.map(Number).filter((n) => Number.isFinite(n));
};

/** Igual que `csvNumbers` pero sin convertir: para enums y uuids. */
export const csvStrings = ({
  value,
}: {
  value: unknown;
}): string[] | undefined => toStringArray(value);
