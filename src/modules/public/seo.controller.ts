import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../iam/decorators';
import { AllowPendingPassword } from '../iam/guards/must-change-password.guard';
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
  constructor(private readonly seo: SeoService) {}

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
}
