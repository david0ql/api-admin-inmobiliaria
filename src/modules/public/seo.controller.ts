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
  /*
    La politica que corresponde a una pagina del sitio, no a una respuesta de
    la API.

    La de helmet trae `img-src 'self'`, que en una respuesta JSON es lo
    correcto y aqui dejaba el mapa de la ficha en gris: las teselas vienen de
    openstreetmap.org. El resto se mantiene igual de cerrado —nada de scripts
    ajenos, nada de eval, nada de marcos— porque esto sigue sirviendo HTML a un
    navegador.

    `unsafe-inline` en los estilos es inevitable: la hoja viaja dentro del HTML
    y Leaflet coloca sus capas con estilos en linea.
  */
  @Header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: https://*.tile.openstreetmap.org",
      "object-src 'none'",
      "script-src 'self'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      'upgrade-insecure-requests',
    ].join('; '),
  )
  async property(@Param('code') code: string): Promise<string> {
    return this.render.property(code);
  }
}
