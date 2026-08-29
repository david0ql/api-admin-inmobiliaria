/**
 * Suelo: lo que se vende por metros y no por habitaciones.
 *
 * Esta es la definición que manda en la aplicación. La migración
 * `1786200000000-UnitTypes` lleva su propia copia a proposito y no debe
 * importar esta: una migración tiene que seguir haciendo lo mismo dentro de
 * diez años, y si leyera de aqui, ampliar la lista cambiaria retroactivamente
 * lo que hizo aquel dia en las bases que ya la ejecutaron. Al cambiar el
 * criterio se cambia SOLO este fichero; lo ya escrito se queda como esta y el
 * reajuste llega solo, inmueble a inmueble, segun se vayan guardando.
 */
const SUELO = /lote|terreno|finca|isla|chacra|campos/i;

export function esSuelo(nombreTipoInmueble: string): boolean {
  return SUELO.test(nombreTipoInmueble);
}

/**
 * Cuanto puede estirarse una tipología de suelo antes de partirse.
 *
 * Un 40%: un lote de 600 m² y otro de 800 son lo mismo para quien busca, y
 * 1.400 ya es otra cosa. Lo habitable no usa esto —se agrupa por alcobas y
 * baños, que no admiten discusion— y por eso el numero vive aqui, con el
 * suelo.
 */
export const TOLERANCIA_SUELO = 0.4;

/** "650 m²", "800 – 1050 m²", "sin área". */
export function etiquetaTramo(min: number | null, max: number | null): string {
  if (!min) return 'sin área';
  const desde = Math.round(min);
  const hasta = max ? Math.round(max) : desde;
  return desde === hasta ? `${desde} m²` : `${desde} – ${hasta} m²`;
}
