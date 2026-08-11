import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Property } from '../properties/domain/property.entity';
import { I18nService } from '../i18n/i18n.service';
import type { Locale } from '../i18n/domain/translation.entity';
import {
  Availability,
  PublicationStatus,
} from '../properties/domain/property.enums';

/**
 * La cabecera de una ficha de inmueble, escrita en el HTML.
 *
 * Hacen falta dos cosas que el sitio, al pintarse en el cliente, no puede dar:
 *
 * 1. WhatsApp y Facebook no ejecutan JavaScript. Al compartir un inmueble
 *    leian el og:title generico del armazon y enseñaban "Serrano Inmobiliaria"
 *    con el logo, en lugar de la casa y su precio. En Colombia el enlace de
 *    WhatsApp ES el canal, asi que eso no era un detalle.
 *
 * 2. La foto principal no se podia ni pedir hasta que el navegador descargaba
 *    el bundle, montaba React, llamaba a la API y sabia su URL: 646 ms parado
 *    antes de empezar a bajar la unica imagen que el visitante quiere ver. Con
 *    el `preload` aqui, la pide nada mas leer la cabecera.
 *
 * Lo que se emite tiene que coincidir con `web-sell/src/lib/seo.ts`, que lo
 * reescribe cuando React monta. Si divergen, el visitante ve una cosa y el
 * buscador otra.
 */
/** Un minuto: un inmueble no cambia de precio dos veces en el mismo minuto. */
const CACHE_MS = 60_000;

@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);
  private cached?: { html: string; mtimeMs: number };

  /**
   * La cabecera ya compuesta de cada ficha.
   *
   * Sin esto, cada visita a un inmueble era una consulta con sus imagenes, su
   * ciudad, su zona, su tipo y su moneda antes de poder mandar el primer byte.
   * Un inmueble no cambia de precio dos veces en el mismo minuto, y esa
   * consulta estaba en el camino critico de lo que el visitante ve.
   *
   * Solo se guarda la cabecera —un par de kB por inmueble, los 642 caben de
   * sobra— y no la pagina entera, que con los estilos dentro son 50 kB.
   */
  private readonly heads = new Map<string, { head: string; hasta: number }>();

  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly config: AppConfigService,
    private readonly i18n: I18nService,
  ) {}

  private get site(): string {
    return this.config.publicSiteUrl.replace(/\/$/, '');
  }

  /**
   * El armazon que genera el build del sitio.
   *
   * Se guarda en memoria y se relee cuando cambia la fecha del fichero: asi un
   * despliegue nuevo entra solo, sin reiniciar la API, y sin leer el disco en
   * cada visita.
   */
  private async shell(): Promise<string> {
    const path = join(this.config.publicSiteDist, 'index.html');
    const { mtimeMs } = await stat(path);
    if (this.cached?.mtimeMs === mtimeMs) return this.cached.html;

    const html = await readFile(path, 'utf8');
    this.cached = { html, mtimeMs };
    return html;
  }

  async property(code: string, locale: Locale = 'es'): Promise<string> {
    const [shell, head] = await Promise.all([
      this.shell(),
      this.headFor(code, locale),
    ]);
    return sinCabeceraGenerica(shell)
      .replace('<html lang="es"', `<html lang="${locale}"`)
      .replace('</head>', head + '</head>');
  }

  private async headFor(code: string, locale: Locale): Promise<string> {
    const ahora = Date.now();
    // La cabecera guardada es por inmueble Y por idioma: son dos textos
    // distintos para la misma ficha.
    const clave = `${locale}:${code}`;
    const guardada = this.heads.get(clave);
    if (guardada && guardada.hasta > ahora) return guardada.head;

    const property = await this.properties.findOne({
      where: { code },
      relations: {
        images: true,
        city: true,
        zone: true,
        propertyType: true,
        currency: true,
      },
    });

    // Un inmueble retirado sigue teniendo su URL circulando por WhatsApp: se
    // sirve el armazon sin mas y la aplicacion enseña su propio mensaje.
    if (
      !property ||
      property.publicationStatus === PublicationStatus.INACTIVE
    ) {
      throw new NotFoundException();
    }

    const head = await this.head(property, locale);
    this.heads.set(clave, { head, hasta: ahora + CACHE_MS });
    return head;
  }

  private async head(property: Property, locale: Locale): Promise<string> {
    /*
      Las frases salen del mismo diccionario que la web: si la agencia cambia
      "for sale" desde el panel, cambia tambien lo que ve Google. Tenerlas
      escritas aqui a mano seria un segundo sitio donde corregirlas, y el que
      nadie recuerda.
    */
    const t = await this.i18n.dictionary(locale);
    const frase = (key: string, vars: Record<string, string | number> = {}) =>
      (t[key] ?? key).replace(/\{(\w+)\}/g, (bruto, nombre: string) =>
        nombre in vars ? String(vars[nombre]) : bruto,
      );
    const ingles = locale === 'en';

    const ruta = `/${slugify(property.title)}/${property.code}`;
    const urlEs = `${this.site}${ruta}`;
    const urlEn = `${this.site}/en${ruta}`;
    const url = ingles ? urlEn : urlEs;
    const place = [property.zone?.name, property.city?.name]
      .filter(Boolean)
      .join(', ');
    const price = property.salePrice ?? property.rentPrice;

    const tipo = property.propertyType
      ? (t[`catalog.propertyType.${property.propertyType.id}`] ??
        property.propertyType.name)
      : frase('property.fallback.type');

    const description = [
      frase('page.property.seo.head.place', {
        type: tipo,
        place: place || frase('page.property.seo.place'),
      }),
      property.area ? `${property.area} m²` : '',
      property.bedrooms
        ? frase('property.spec.bedrooms.count', { count: property.bedrooms })
        : '',
      property.bathrooms
        ? frase('property.spec.bathrooms.count', { count: property.bathrooms })
        : '',
      price ? money(price, property.currency?.iso) : '',
    ]
      .filter(Boolean)
      .join(' · ')
      .concat(frase('page.property.seo.head.cta'))
      .slice(0, 158);

    /*
      El titulo en ingles se arma con sus piezas, como en la web: el guardado
      esta en español y lleva dentro el nombre del barrio.
    */
    const titulo = ingles
      ? frase(
          property.forRent ? 'property.title.rent' : 'property.title.sale',
          { type: tipo, place: place || frase('page.property.seo.place') },
        )
      : property.title;
    const title = `${titulo} · Serrano Inmobiliaria`;
    const images = [...(property.images ?? [])].sort(
      (a, b) => Number(b.isMain) - Number(a.isMain) || a.position - b.position,
    );
    const cover = images[0];

    const tags = [
      `<title>${esc(title)}</title>`,
      meta('name', 'description', description),
      `<link rel="canonical" href="${esc(url)}" />`,
      meta(
        'name',
        'robots',
        'index, follow, max-image-preview:large, max-snippet:-1',
      ),
      meta('property', 'og:type', 'article'),
      meta('property', 'og:title', title),
      meta('property', 'og:description', description),
      meta('property', 'og:url', url),
      meta('property', 'og:locale', ingles ? 'en_US' : 'es_CO'),
      meta('property', 'og:locale:alternate', ingles ? 'es_CO' : 'en_US'),
      // Las dos versiones, declaradas hermanas tambien aqui: esto es lo que
      // lee un buscador cuando pide la ficha, antes de que arranque la web.
      `<link rel="alternate" hreflang="es" href="${esc(urlEs)}" />`,
      `<link rel="alternate" hreflang="en" href="${esc(urlEn)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${esc(urlEs)}" />`,
      meta('name', 'twitter:card', 'summary_large_image'),
      meta('name', 'twitter:title', title),
      meta('name', 'twitter:description', description),
    ];

    if (cover) {
      // Los mismos `srcset` y `sizes` que la galeria, o el navegador precarga
      // un ancho y luego descarga otro: dos fotos por el precio de una.
      const srcset = [
        `${cover.url} 560w`,
        cover.urlMedium ? `${cover.urlMedium} 800w` : '',
        `${cover.urlLarge} 1600w`,
        cover.urlOriginal ? `${cover.urlOriginal} 2560w` : '',
      ]
        .filter(Boolean)
        .join(', ');

      tags.push(
        `<link rel="preload" as="image" href="${esc(cover.urlLarge)}" ` +
          `imagesrcset="${esc(srcset)}" ` +
          `imagesizes="(min-width: 1200px) 840px, (min-width: 992px) 60vw, 100vw" ` +
          `fetchpriority="high" />`,
        // Absoluta: las redes sociales no resuelven rutas relativas.
        meta('property', 'og:image', this.site + cover.urlLarge),
        meta('property', 'og:image:alt', property.title),
        meta('name', 'twitter:image', this.site + cover.urlLarge),
        // El esqueleto de la ficha lo lee para pintar la portada en cuanto
        // monta React, sin esperar a que la API conteste: la foto ya esta
        // descargada por el `preload` de arriba, solo faltaba saber cual era.
        //
        // Va en un `meta` y no en un `<script>` inline porque la politica de
        // seguridad de la API no permite scripts en linea, y esa politica esta
        // bien como esta: no se debilita por un dato de cuatro campos.
        meta(
          'name',
          'ficha:portada',
          JSON.stringify({
            code: property.code,
            url: cover.urlLarge,
            srcset,
            alt: cover.description ?? `${property.title} — foto 1`,
          }),
        ),
      );
    }

    tags.push(
      jsonLd('property', this.propertyJsonLd(property, url, images)),
      jsonLd('crumbs', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'Inicio', url: `${this.site}/` },
          { name: 'Ventas', url: `${this.site}/venta` },
          { name: property.title, url },
        ].map((step, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: step.name,
          item: step.url,
        })),
      }),
    );

    return tags.join('\n    ') + '\n  ';
  }

  private propertyJsonLd(
    property: Property,
    url: string,
    images: Property['images'],
  ): Record<string, unknown> {
    const price = property.salePrice ?? property.rentPrice;

    return {
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      '@id': url,
      url,
      name: property.title,
      description: (property.observations ?? property.title).slice(0, 400),
      datePosted: property.createdAt?.toISOString(),
      image: images.slice(0, 6).map((image) => this.site + image.urlLarge),
      provider: { '@id': `${this.site}/#organization` },
      mainEntity: {
        '@type': 'Residence',
        name: property.title,
        address: {
          '@type': 'PostalAddress',
          streetAddress: property.address ?? undefined,
          addressLocality: property.city?.name,
          addressRegion: 'Santander',
          addressCountry: 'CO',
        },
        geo:
          property.latitude != null && property.longitude != null
            ? {
                '@type': 'GeoCoordinates',
                latitude: Number(property.latitude),
                longitude: Number(property.longitude),
              }
            : undefined,
        numberOfRooms: property.bedrooms ?? undefined,
        numberOfBathroomsTotal: property.bathrooms ?? undefined,
        floorSize: property.area
          ? {
              '@type': 'QuantitativeValue',
              value: Number(property.area),
              unitCode: 'MTK',
            }
          : undefined,
        yearBuilt: property.buildingYear ?? undefined,
      },
      offers: price
        ? {
            '@type': 'Offer',
            price: Number(price),
            priceCurrency: property.currency?.iso ?? 'COP',
            availability:
              property.availability === Availability.AVAILABLE
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            url,
            seller: { '@id': `${this.site}/#organization` },
          }
        : undefined,
    };
  }
}

/**
 * Quita del armazon las etiquetas que esta ficha va a poner por su cuenta.
 *
 * Sin esto quedan dos `<title>` y dos `og:title`: el navegador y las redes
 * sociales se quedan con el primero, que es justo el generico que se venia a
 * sustituir. El resto de la cabecera —og:site_name, la tipografia, el idioma—
 * se queda como esta.
 */
function sinCabeceraGenerica(html: string): string {
  const CLAVES = [
    'description',
    'robots',
    'og:type',
    'og:title',
    'og:description',
    'og:url',
    'og:image',
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image',
  ];

  let salida = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<link[^>]*rel="canonical"[^>]*>/i, '');

  for (const clave of CLAVES) {
    salida = salida.replace(
      new RegExp(
        `<meta[^>]*(?:name|property)="${clave.replace(':', ':')}"[^>]*>`,
        'gi',
      ),
      '',
    );
  }

  return salida;
}

function meta(kind: 'name' | 'property', key: string, value: string): string {
  return `<meta ${kind}="${key}" content="${esc(value)}" />`;
}

/**
 * El mismo atributo que usa el cliente (`data-jsonld-<id>`), para que al montar
 * React sustituya este bloque en lugar de añadir un segundo.
 */
function jsonLd(id: string, data: unknown): string {
  // `<` escapado: un titulo con "</script>" dentro cerraria la etiqueta y todo
  // lo que viniera detras se ejecutaria como HTML.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json" data-jsonld-${id}>${json}</script>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value: string | number, iso = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: iso,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

/** Debe producir el mismo slug que la web, o la canonica no coincidira. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
