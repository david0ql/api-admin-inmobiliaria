import { Injectable, Logger } from '@nestjs/common';

/** Lo que la web necesita para pintar un precio en dólares. */
export interface ExchangeRate {
  /** Cuántos pesos vale un dólar. */
  rate: number;
  /** El día al que corresponde, `YYYY-MM-DD`. */
  date: string;
  /** De dónde salió, para poder decirlo en la web. */
  source: 'TRM' | 'ER-API';
}

/*
  La TRM —Tasa Representativa del Mercado— es la tasa oficial que publica la
  Superfinanciera y la que se usa en Colombia para cualquier conversión formal.
  Está en el portal de datos abiertos del Estado: gratis, sin clave y sin
  registro.
*/
const TRM =
  'https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC';

/*
  Y una segunda fuente por si la primera se cae, que es un portal público y a
  veces tarda. Da la tasa de mercado, no la oficial: se marca como tal para no
  hacerla pasar por lo que no es.
*/
const RESPALDO = 'https://open.er-api.com/v6/latest/USD';

/** Doce horas: la TRM cambia una vez al día. */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Ni un dólar a mil pesos ni a veinte mil: eso sería una respuesta rota. */
const MINIMO = 1_000;
const MAXIMO = 20_000;

/**
 * El valor del dólar, para el conmutador de la web.
 *
 * Se consulta como mucho dos veces al día y se guarda en memoria. Si las dos
 * fuentes fallan se devuelve lo último que se supo, aunque sea de ayer: un
 * precio convertido con la tasa de ayer es útil; no poder cambiar de moneda,
 * no. Y si nunca se supo, se devuelve `null` y la web esconde el conmutador en
 * lugar de inventarse una cifra.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cache?: { value: ExchangeRate; hasta: number };

  async usd(): Promise<ExchangeRate | null> {
    const ahora = Date.now();
    if (this.cache && this.cache.hasta > ahora) return this.cache.value;

    const valor = (await this.trm()) ?? (await this.respaldo());

    if (!valor) {
      // Lo de antes, aunque haya caducado: mejor la tasa de ayer que ninguna.
      return this.cache?.value ?? null;
    }

    this.cache = { value: valor, hasta: ahora + TTL_MS };
    return valor;
  }

  private async trm(): Promise<ExchangeRate | null> {
    try {
      const filas =
        await this.pedir<{ valor: string; vigenciadesde: string }[]>(TRM);
      const rate = Number(filas?.[0]?.valor);
      const date = filas?.[0]?.vigenciadesde?.slice(0, 10);
      if (!this.razonable(rate) || !date) return null;
      return { rate, date, source: 'TRM' };
    } catch (error) {
      this.logger.warn(`TRM no disponible: ${(error as Error).message}`);
      return null;
    }
  }

  private async respaldo(): Promise<ExchangeRate | null> {
    try {
      const datos = await this.pedir<{
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      }>(RESPALDO);
      const rate = datos?.rates?.COP;
      if (!this.razonable(rate)) return null;
      return {
        rate: Number(rate),
        date: new Date(datos.time_last_update_utc ?? Date.now())
          .toISOString()
          .slice(0, 10),
        source: 'ER-API',
      };
    } catch (error) {
      this.logger.warn(`Respaldo no disponible: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Con tiempo límite propio.
   *
   * Sin él, un portal público que tarda treinta segundos deja colgada una
   * petición de la portada: esto es un adorno del precio, no puede frenar la
   * página.
   */
  private async pedir<T>(url: string): Promise<T> {
    const corte = AbortSignal.timeout(4_000);
    const respuesta = await fetch(url, { signal: corte });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    return (await respuesta.json()) as T;
  }

  private razonable(valor: unknown): valor is number {
    const n = Number(valor);
    return Number.isFinite(n) && n > MINIMO && n < MAXIMO;
  }
}
