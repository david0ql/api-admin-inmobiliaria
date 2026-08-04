import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { CacheBuster } from './cache-buster.service';
import { PropertyCacheSubscriber } from './property-cache.subscriber';

/**
 * La caché del sitio público.
 *
 * En memoria del proceso, no Redis: la API corre en una sola instancia (ver
 * `ecosystem.config.js`, modo fork), así que un servidor aparte solo añadiría
 * una pieza que puede caerse. El día que haya dos instancias, aquí se cambia el
 * `store` y ya.
 *
 * `max` acotado porque las claves llevan los filtros de búsqueda dentro: sin
 * tope, un rastreador probando combinaciones llenaría la memoria del proceso.
 */
@Global()
@Module({
  imports: [
    NestCacheModule.register({
      isGlobal: true,
      ttl: 300_000,
      max: 500,
    }),
  ],
  providers: [CacheBuster, PropertyCacheSubscriber],
  exports: [NestCacheModule, CacheBuster],
})
export class AppCacheModule {}
