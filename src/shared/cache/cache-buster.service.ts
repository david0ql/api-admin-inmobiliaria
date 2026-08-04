import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';

/**
 * Tira la caché cuando algo cambia.
 *
 * Sin esto, cachear sería un paso atrás: la agencia guarda un ajuste, recarga
 * la web y no ve nada durante cinco minutos. Peor que lento es que parezca
 * roto.
 *
 * Lo que NO se puede tirar es lo que ya está en el navegador del visitante. Esa
 * copia vive hasta que caduca y nadie puede quitársela — por eso los tiempos
 * son cortos y por eso el panel lo dice con todas las letras en lugar de
 * dejar que alguien piense que su cambio no se guardó.
 */
@Injectable()
export class CacheBuster {
  private readonly logger = new Logger(CacheBuster.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * Vacía lo público.
   *
   * Se tira entero y no por claves: las respuestas se guardan por URL con sus
   * filtros, así que un inmueble que cambia de precio aparece en decenas de
   * combinaciones distintas. Rastrearlas costaría más que rehacerlas — son
   * consultas de milisegundos.
   */
  async flush(motivo: string): Promise<void> {
    try {
      await this.cache.clear();
      this.logger.log(`Cache publica vaciada: ${motivo}`);
    } catch (error) {
      this.logger.warn(
        `No se pudo vaciar la cache: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }
}
