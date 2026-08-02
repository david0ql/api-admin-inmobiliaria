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

/** Rutas fijas del sitio publico, con la importancia que les corresponde. */
const STATIC_ROUTES: { path: string; priority: number; changefreq: string }[] =
  [
    { path: '/', priority: 1.0, changefreq: 'daily' },
    { path: '/s/ventas', priority: 0.9, changefreq: 'daily' },
    { path: '/proyectos', priority: 0.8, changefreq: 'weekly' },
    { path: '/main-contactenos.htm', priority: 0.4, changefreq: 'yearly' },
    { path: '/main-contenido-cat-6.htm', priority: 0.2, changefreq: 'yearly' },
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
        entry(`${this.site}/s/${slugify(type.name)}/ventas`, now, 'daily', 0.7),
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
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n'
    );
  }
}

function entry(
  loc: string,
  lastmod: string,
  changefreq: string,
  priority: number,
): string {
  return (
    '  <url>' +
    `<loc>${escapeXml(loc)}</loc>` +
    `<lastmod>${lastmod.slice(0, 10)}</lastmod>` +
    `<changefreq>${changefreq}</changefreq>` +
    `<priority>${priority.toFixed(1)}</priority>` +
    '</url>'
  );
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
