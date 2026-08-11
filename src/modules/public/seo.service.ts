import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Property } from '../properties/domain/property.entity';
import { PropertyFamily } from '../properties/domain/property-family.entity';
import { PropertyType } from '../catalog/domain/catalogs.entity';
import {
  Availability,
  PublicationStatus,
} from '../properties/domain/property.enums';

const VISIBLE = [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING];

/**
 * Rutas fijas del sitio publico, con la importancia que les corresponde.
 *
 * Son las de `ROUTES` en `web-sell/src/lib/site.ts`. Las viejas de WASI
 * (`/s/ventas`, `/main-*.htm`) NO van aqui aunque sigan respondiendo: un
 * sitemap que anuncia una URL que redirige le esta pidiendo al buscador que
 * indexe el destino por el camino largo.
 */
const STATIC_ROUTES: { path: string; priority: number; changefreq: string }[] =
  [
    { path: '/', priority: 1.0, changefreq: 'daily' },
    { path: '/venta', priority: 0.9, changefreq: 'daily' },
    { path: '/proyectos', priority: 0.8, changefreq: 'weekly' },
    { path: '/contacto', priority: 0.4, changefreq: 'yearly' },
    { path: '/privacidad', priority: 0.2, changefreq: 'yearly' },
  ];

@Injectable()
export class SeoService {
  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(PropertyFamily)
    private readonly families: Repository<PropertyFamily>,
    @InjectRepository(PropertyType)
    private readonly types: Repository<PropertyType>,
    private readonly config: AppConfigService,
  ) {}

  private get site(): string {
    return this.config.publicSiteUrl.replace(/\/$/, '');
  }

  robots(): string {
    return [
      'User-agent: *',
      'Allow: /',
      '',
      '# El panel interno y la API no son contenido: indexarlos solo gasta',
      '# presupuesto de rastreo y expone rutas que nadie debe encontrar.',
      'Disallow: /api/',
      'Disallow: /media/',
      '',
      '# Los buscadores internos generan infinitas combinaciones de filtros.',
      '# Se deja rastrear el listado, no cada permutacion.',
      'Disallow: /*?*page=',
      'Disallow: /*?*sort=',
      '',
      `Sitemap: ${this.site}/sitemap.xml`,
      '',
    ].join('\n');
  }

  /**
   * Mapa del sitio con las rutas fijas, los tipos de inmueble, los proyectos
   * publicados y cada inmueble visible.
   *
   * `lastmod` sale de `updatedAt`: es lo que le dice al buscador que vuelva a
   * pasar por una ficha cuyo precio ha cambiado.
   */
  async sitemap(): Promise<string> {
    const [properties, families, types] = await Promise.all([
      this.properties.find({
        where: VISIBLE.map((publicationStatus) => ({
          publicationStatus,
          availability: Availability.AVAILABLE,
        })),
        select: { code: true, title: true, updatedAt: true },
        loadEagerRelations: false,
        order: { updatedAt: 'DESC' },
        take: 45_000,
      }),
      this.families.find({
        where: { published: true },
        select: { slug: true, updatedAt: true },
        loadEagerRelations: false,
      }),
      this.types.find({ where: { active: true }, select: { name: true } }),
    ]);

    const urls: string[] = [];
    const now = new Date().toISOString();

    for (const route of STATIC_ROUTES) {
      urls.push(
        entry(
          `${this.site}${route.path}`,
          now,
          route.changefreq,
          route.priority,
        ),
      );
    }

    // Un listado por tipo: "apartamentos en venta" es la busqueda real que
    // hace la gente, y merece su propia URL indexable.
    for (const type of types) {
      urls.push(
        entry(`${this.site}/venta/${slugify(type.name)}`, now, 'daily', 0.7),
      );
    }

    for (const family of families) {
      urls.push(
        entry(
          `${this.site}/proyectos/${family.slug}`,
          family.updatedAt.toISOString(),
          'weekly',
          0.7,
        ),
      );
    }

    for (const property of properties) {
      urls.push(
        entry(
          `${this.site}/${slugify(property.title)}/${property.code}`,
          property.updatedAt.toISOString(),
          'weekly',
          0.6,
        ),
      );
    }

    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
      'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
      urls.join('\n') +
      '\n</urlset>\n'
    );
  }
}

/**
 * Una URL del mapa, con su hermana en el otro idioma.
 *
 * Cada direccion se declara dos veces —español e ingles— y cada una lleva
 * dentro los `xhtml:link` que apuntan a la otra. Es lo que le dice a un
 * buscador que no son dos paginas parecidas sino la misma en dos idiomas: sin
 * eso, o indexa una sola o las trata como duplicadas.
 *
 * `x-default` apunta al español: es el mercado de la agencia y quien no encaja
 * en ninguno de los dos idiomas acaba ahi.
 */
function entry(
  loc: string,
  lastmod: string,
  changefreq: string,
  priority: number,
): string {
  const ruta = loc.replace(/^https?:\/\/[^/]+/, '') || '/';
  const base = loc.slice(0, loc.length - ruta.length);
  const es = base + ruta;
  const en = base + (ruta === '/' ? '/en' : `/en${ruta}`);

  const alternativas = [
    `<xhtml:link rel="alternate" hreflang="es" href="${escapeXml(es)}"/>`,
    `<xhtml:link rel="alternate" hreflang="en" href="${escapeXml(en)}"/>`,
    `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(es)}"/>`,
  ].join('');

  const una = (href: string) =>
    '  <url>' +
    `<loc>${escapeXml(href)}</loc>` +
    `<lastmod>${lastmod.slice(0, 10)}</lastmod>` +
    `<changefreq>${changefreq}</changefreq>` +
    `<priority>${priority.toFixed(1)}</priority>` +
    alternativas +
    '</url>';

  return `${una(es)}\n${una(en)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Debe producir el mismo slug que la web, o los enlaces no coincidiran. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
