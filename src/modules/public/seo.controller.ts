import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../iam/decorators';
import { AllowPendingPassword } from '../iam/guards/must-change-password.guard';
import { RenderService } from './render.service';
import { SeoService } from './seo.service';

/**
 * `robots.txt` y `sitemap.xml`.
 *
 * Se generan aqui y no como ficheros estaticos en la web porque el mapa del
 * sitio tiene que listar los 617 inmuebles publicados uno a uno, con su fecha
 * de ultima modificacion. Un fichero escrito a mano estaria desactualizado el
 * dia que alguien de la agencia publique un inmueble nuevo.
 *
 * Quedan fuera de Swagger: no son parte de la API que consume nadie.
 */
@ApiExcludeController()
@Public()
@AllowPendingPassword()
@Controller()
export class SeoController {
  constructor(
    private readonly seo: SeoService,
    private readonly render: RenderService,
  ) {}

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  robots(): string {
    return this.seo.robots();
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  // Una hora: el inventario cambia a diario, no cada minuto.
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap(): Promise<string> {
    return this.seo.sitemap();
  }

  /**
   * La ficha de un inmueble con su cabecera ya escrita.
   *
   * Se la pide nginx para las URLs con la forma `/<titulo>/<codigo>`; el resto
   * del sitio sigue saliendo del disco sin pasar por aqui. Si esto falla, nginx
   * sirve el armazon de siempre: la ficha se vera igual, solo sin la cabecera.
   *
   * Sin `Cache-Control` publica: la respuesta lleva el precio y la
   * disponibilidad, y un intermediario cacheandola durante horas es como se
   * enseña un inmueble ya vendido.
   */
  @Get('render/:slug/:code')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async property(@Param('code') code: string): Promise<string> {
    return this.render.property(code);
  }
}
