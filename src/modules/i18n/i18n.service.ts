import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CacheBuster } from '../../shared/cache/cache-buster.service';
import { LOCALES, Translation, type Locale } from './domain/translation.entity';

export type Diccionario = Record<string, string>;

/**
 * Las frases de la web, en los dos idiomas.
 *
 * Dos capas: el fichero del repositorio, que es lo que escribió quien programa,
 * y la tabla, que es lo que la agencia cambió desde el panel. La segunda pisa a
 * la primera clave a clave, así que se puede corregir una frase sin tocar el
 * resto y borrarla devuelve la original.
 *
 * Todo se resuelve en memoria: son unos cientos de frases y las lee cada visita
 * a la web. La caché se tira entera al guardar, que pasa una vez cada mucho.
 */
@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);
  private readonly base = new Map<Locale, Diccionario>();
  private cache = new Map<Locale, { value: Diccionario; hasta: number }>();

  constructor(
    @InjectRepository(Translation)
    private readonly repo: Repository<Translation>,
    private readonly buster: CacheBuster,
  ) {
    for (const locale of LOCALES) this.base.set(locale, this.leerFichero(locale));
  }

  /** Lo que la web pide para pintarse. */
  async dictionary(locale: Locale): Promise<Diccionario> {
    const ahora = Date.now();
    const guardado = this.cache.get(locale);
    if (guardado && guardado.hasta > ahora) return guardado.value;

    const filas = await this.repo.find({ where: { locale } });
    const value = { ...(this.base.get(locale) ?? {}) };
    for (const fila of filas) value[fila.key] = fila.value;

    this.cache.set(locale, { value, hasta: ahora + 60_000 });
    return value;
  }

  /**
   * El listado del panel: cada clave con lo que dice en los dos idiomas y de
   * dónde viene cada texto.
   *
   * Las claves salen del fichero, no de la tabla: la tabla solo tiene lo
   * editado, así que si mandara ella, el panel empezaría vacío y no habría
   * forma de descubrir qué frases existen.
   */
  async entries(filtros: {
    q?: string;
    missing?: boolean;
    edited?: boolean;
  }): Promise<
    {
      key: string;
      es: string;
      en: string;
      esEdited: boolean;
      enEdited: boolean;
    }[]
  > {
    const [es, en] = await Promise.all([
      this.dictionary('es'),
      this.dictionary('en'),
    ]);
    const editadas = await this.repo.find();
    const tocada = new Set(editadas.map((t) => `${t.locale}:${t.key}`));

    const claves = new Set([
      ...Object.keys(this.base.get('es') ?? {}),
      ...Object.keys(this.base.get('en') ?? {}),
      ...editadas.map((t) => t.key),
    ]);

    const q = filtros.q?.trim().toLowerCase();

    return [...claves]
      .sort()
      .map((key) => ({
        key,
        es: es[key] ?? '',
        en: en[key] ?? '',
        esEdited: tocada.has(`es:${key}`),
        enEdited: tocada.has(`en:${key}`),
      }))
      .filter((fila) => {
        if (filtros.missing && fila.es && fila.en) return false;
        if (filtros.edited && !fila.esEdited && !fila.enEdited) return false;
        if (!q) return true;
        return (
          fila.key.toLowerCase().includes(q) ||
          fila.es.toLowerCase().includes(q) ||
          fila.en.toLowerCase().includes(q)
        );
      });
  }

  /** Guardar una frase. Con el texto vacío se vuelve a la original. */
  async set(locale: Locale, key: string, value: string): Promise<void> {
    const limpio = value.trim();

    if (!limpio) {
      await this.repo.delete({ locale, key });
    } else {
      const existente = await this.repo.findOne({ where: { locale, key } });
      if (existente) {
        await this.repo.update({ id: existente.id }, { value: limpio });
      } else {
        await this.repo.save(this.repo.create({ locale, key, value: limpio }));
      }
    }

    this.cache.delete(locale);
    // Sin esto la agencia guarda y no ve el cambio en cinco minutos: peor que
    // lento es que parezca que no se guardo.
    await this.buster.flush(`traducciones (${locale})`);
  }

  /**
   * El fichero de partida.
   *
   * Se lee al arrancar y se queda en memoria. Si falta o está roto, se sigue
   * con un diccionario vacío: la web tiene su propia copia empaquetada y
   * quedarse sin idioma por un JSON mal editado sería tirar el sitio entero.
   */
  private leerFichero(locale: Locale): Diccionario {
    try {
      const ruta = join(__dirname, 'defaults', `${locale}.json`);
      return JSON.parse(readFileSync(ruta, 'utf8')) as Diccionario;
    } catch (error) {
      this.logger.error(
        `No pude leer las frases de "${locale}": ${(error as Error).message}`,
      );
      return {};
    }
  }
}
