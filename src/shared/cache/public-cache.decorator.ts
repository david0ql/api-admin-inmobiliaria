import { SetMetadata } from '@nestjs/common';

export const PUBLIC_CACHE_TTL = 'public-cache-ttl';

/**
 * Cuánto vale esta respuesta, en segundos.
 *
 * Marca una ruta GET como cacheable: el servidor guarda el resultado y el
 * navegador recibe permiso para quedárselo el mismo tiempo.
 *
 * Solo para lo que es igual para todo el mundo. Nada que dependa de quién
 * pregunta, y nada que tenga efecto al leerse — la ficha pública, por ejemplo,
 * suma una visita cada vez, y cachearla dejaría el contador congelado.
 */
export const PublicCache = (seconds: number) =>
  SetMetadata(PUBLIC_CACHE_TTL, seconds);
