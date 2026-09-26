import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../iam/decorators';
import { renderFeed } from './sync/feed-xml';
import { PortalSyncService } from './sync/portal-sync.service';

/**
 * Lo que los portales llaman desde fuera: el resultado de una publicacion
 * asincrona y el feed de los agregadores.
 *
 * Sin sesion —un portal no tiene cuenta aqui— pero con el token de la conexion
 * en la ruta. Quien no lo tiene recibe un 404, no un 401: no se le confirma
 * siquiera que la ruta exista.
 */
@Public()
@ApiExcludeController()
@Controller('public')
export class PortalPublicController {
  constructor(private readonly sync: PortalSyncService) {}

  @Post('portal-callbacks/:portalId/:token')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async callback(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Param('token') token: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const applied = await this.sync.callback(portalId, token, body, headers);
    return { ok: true, applied };
  }

  @Get('feeds/:portalId/:file')
  @SkipThrottle()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async feed(
    @Param('portalId', ParseIntPipe) portalId: number,
    @Param('file') file: string,
  ): Promise<string> {
    const token = /^([a-f0-9]{16,64})\.xml$/.exec(file)?.[1];
    if (!token) throw new NotFoundException();
    const { connection, listings } = await this.sync.feed(portalId, token);
    return renderFeed(listings, connection.settings);
  }
}
