import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, of, tap } from 'rxjs';
import { PUBLIC_CACHE_TTL } from './public-cache.decorator';

/**
 * La caché de lo público.
 *
 * Hace dos cosas a la vez, y las dos hacen falta:
 *
 * 1. Guarda la respuesta en memoria, así que veinte visitantes seguidos
 *    preguntando por el catálogo son UNA consulta a la base.
 * 2. Le dice al navegador que puede quedársela, así que el mismo visitante
 *    moviéndose por el sitio no vuelve a pedirla siquiera.
 *
 * Lo segundo es lo que se nota, y también lo que hay que explicar: una vez que
 * el navegador de alguien se guardó una respuesta, ya no hay forma de
 * quitársela hasta que caduque. Por eso los tiempos son cortos y por eso en el
 * panel se avisa.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const seconds = this.reflector.getAllAndOverride<number | undefined>(
      PUBLIC_CACHE_TTL,
      [context.getHandler(), context.getClass()],
    );
    if (!seconds) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.method !== 'GET') return next.handle();

    const response = http.getResponse<Response>();
    // `stale-while-revalidate`: pasado el minuto de gracia el navegador puede
    // seguir enseñando lo viejo mientras pide lo nuevo por detrás, en lugar de
    // dejar al visitante esperando.
    response.setHeader(
      'Cache-Control',
      `public, max-age=${seconds}, stale-while-revalidate=60`,
    );

    // La URL entera: dos búsquedas con filtros distintos no son la misma
    // respuesta.
    const key = `pub:${request.originalUrl}`;

    const hit = await this.cache.get(key);
    if (hit !== undefined && hit !== null) {
      response.setHeader('X-Cache', 'HIT');
      return of(hit);
    }

    response.setHeader('X-Cache', 'MISS');
    return next.handle().pipe(
      tap((body) => {
        if (body !== undefined && body !== null) {
          void this.cache.set(key, body, seconds * 1000);
        }
      }),
    );
  }
}
