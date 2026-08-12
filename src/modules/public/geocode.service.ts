import { Injectable, Logger } from '@nestjs/common';

export interface Lugar {
  /** ISO 3166-1 alfa-2, en mayúsculas: CO, US, ES. */
  countryCode: string;
  countryName: string;
  city: string | null;
}

/*
  BigDataCloud: gratis, sin clave y sin registro para la geocodificación
  inversa. Se llama desde el servidor y no desde el navegador para no abrir el
  CSP del sitio a un dominio de terceros por un adorno.
*/
const SERVICIO = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/** Un cuadrado de ~1 km: dos personas de la misma manzana comparten respuesta. */
const REDONDEO = 2;

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * En qué país está un punto.
 *
 * Se usa para saludar a quien llega de fuera —"parece que estás en Estados
 * Unidos"— y para decidir si conviene enseñarle los precios en dólares.
 *
 * La coordenada se redondea a dos decimales antes de preguntar y de guardar:
 * para saber el país sobra un kilómetro de precisión, y guardar la posición
 * exacta de alguien en una caché es guardar dónde vive.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly cache = new Map<string, { value: Lugar; hasta: number }>();

  async where(lat: number, lng: number): Promise<Lugar | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const rlat = Number(lat.toFixed(REDONDEO));
    const rlng = Number(lng.toFixed(REDONDEO));
    const clave = `${rlat},${rlng}`;

    const ahora = Date.now();
    const guardado = this.cache.get(clave);
    if (guardado && guardado.hasta > ahora) return guardado.value;

    try {
      const respuesta = await fetch(
        `${SERVICIO}?latitude=${rlat}&longitude=${rlng}&localityLanguage=es`,
        { signal: AbortSignal.timeout(4_000) },
      );
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

      const datos = (await respuesta.json()) as {
        countryCode?: string;
        countryName?: string;
        city?: string;
        locality?: string;
      };

      if (!datos.countryCode) return null;

      const value: Lugar = {
        countryCode: datos.countryCode.toUpperCase(),
        countryName: datos.countryName ?? datos.countryCode,
        city: datos.city || datos.locality || null,
      };

      this.cache.set(clave, { value, hasta: ahora + TTL_MS });
      return value;
    } catch (error) {
      // Sin país, la web enseña los inmuebles cercanos igual: lo que no se
      // puede es dejar de responder por un adorno.
      this.logger.warn(`Geocodificación inversa: ${(error as Error).message}`);
      return null;
    }
  }
}
