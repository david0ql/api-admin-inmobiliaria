import type { PortalListing } from './listing';
import { stripControl } from './text';

/**
 * El feed de los agregadores.
 *
 * Dos formatos, elegidos con el ajuste `format` de la conexion:
 *
 *  - `trovit` (por defecto): el de Trovit/Mitula, que es el que se propone a
 *    los agregadores que no tienen formato propio (Doomos, Luxury Estate,
 *    Arriendo.com).
 *  - `clasf`: el propio de Clasf, que NO es Trovit (<ads><ad>, categorias
 *    suyas y descripcion de 100 caracteres como minimo).
 *
 * El feed es el inventario COMPLETO del portal: lo que no aparece se da por
 * retirado en la siguiente lectura.
 */
export function renderFeed(
  listings: PortalListing[],
  settings: Record<string, string>,
): string {
  if (settings.format === 'clasf') return renderClasf(listings, settings);
  const ads = listings.flatMap((listing) =>
    operations(listing).map((op) => ad(listing, op, settings)),
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<trovit>\n${ads.join('\n')}\n</trovit>\n`;
}

type Operation = 'sale' | 'rent';

/**
 * Venta y arriendo son dos anuncios: el formato solo admite un tipo por
 * anuncio, y un inmueble que se ofrece de las dos formas tiene dos precios.
 */
function operations(listing: PortalListing): Operation[] {
  const ops: Operation[] = [];
  if (listing.forSale && listing.salePrice) ops.push('sale');
  if (listing.forRent && listing.rentPrice) ops.push('rent');
  return ops;
}

function ad(
  listing: PortalListing,
  op: Operation,
  settings: Record<string, string>,
): string {
  const price = op === 'sale' ? listing.salePrice : listing.rentPrice;
  const area = listing.builtArea ?? listing.privateArea ?? listing.area;
  const email = settings.contactEmail || listing.agent?.email || '';
  const phone = settings.contactPhone || listing.agent?.phone || '';
  const lines = [
    tag('id', op === 'sale' ? listing.code : `${listing.code}-A`),
    tag('url', listing.publicUrl),
    tag('title', listing.title),
    tag('type', op === 'sale' ? 'For Sale' : 'For Rent'),
    tag('content', listing.description || listing.title),
    price != null
      ? `<price${op === 'rent' ? ' period="monthly"' : ''}>${Math.round(price)}</price>`
      : null,
    tag('currency', listing.currency),
    tag('property_type', listing.propertyTypeName),
    area ? `<floor_area unit="meters">${Math.round(area)}</floor_area>` : null,
    num('rooms', listing.bedrooms),
    num('bathrooms', listing.bathrooms),
    num('parking', listing.garages),
    num('floor_number', listing.floor),
    listing.showExactLocation ? tag('address', listing.address) : null,
    tag('neighborhood', listing.zoneName),
    tag('city', listing.cityName),
    tag('region', listing.regionName),
    tag('country', listing.countryName ?? 'Colombia'),
    listing.latitude != null && listing.longitude != null
      ? `${num('latitude', listing.latitude)}${num('longitude', listing.longitude)}`
      : null,
    num('year', listing.buildingYear),
    num('stratum', listing.stratum),
    tag('agency', settings.agencyName || 'Serrano Inmobiliaria'),
    tag('contact_email', email),
    tag('contact_telephone', phone),
    tag('is_new', listing.condition === 'NEW' ? '1' : '0'),
    listing.images.length
      ? `<pictures>${listing.images
          .map((url) => `<picture>${tag('picture_url', url)}</picture>`)
          .join('')}</pictures>`
      : null,
    listing.videoUrl
      ? tag('virtual_tour', listing.tourUrl ?? listing.videoUrl)
      : null,
  ];
  return `  <ad>\n    ${lines.filter(Boolean).join('\n    ')}\n  </ad>`;
}

function tag(name: string, value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return `<${name}><![CDATA[${cdata(value)}]]></${name}>`;
}

function num(name: string, value: number | null | undefined): string {
  return value == null ? '' : `<${name}>${value}</${name}>`;
}

/** `]]>` dentro de un CDATA lo cerraria: se parte en dos. */
function cdata(value: string): string {
  // Fuera tambien los caracteres de control, que invalidan el XML entero.
  return stripControl(value).replaceAll(']]>', ']]]]><![CDATA[>');
}

// --- Clasf -------------------------------------------------------------------

/** Nuestro tipo (ids de WASI) → rama de la taxonomia de Clasf para inmuebles. */
const CLASF_BRANCH: Record<number, [string, string]> = {
  1: ['viviendas', 'casas'],
  10: ['viviendas', 'casas'],
  11: ['viviendas', 'casas'],
  19: ['viviendas', 'casas'],
  22: ['viviendas', 'casas'],
  24: ['viviendas', 'casas'],
  28: ['viviendas', 'casas'],
  2: ['viviendas', 'apartamentos'],
  14: ['viviendas', 'apartamentos'],
  20: ['viviendas', 'apartamentos'],
  21: ['viviendas', 'apartamentos'],
  3: ['locales', 'locales'],
  4: ['oficinas', 'oficinas'],
  15: ['oficinas', 'oficinas'],
  5: ['terrenos', 'terrenos'],
  6: ['terrenos', 'terrenos'],
  17: ['terrenos', 'terrenos'],
  7: ['fincas', 'fincas'],
  8: ['bodegas', 'bodegas'],
};

/** Lo que Clasf exige y el formato Trovit no: se comprueba antes de meterlo. */
export function clasfProblems(
  listing: PortalListing,
  settings: Record<string, string>,
): string[] {
  const faltas: string[] = [];
  if (listing.description.length < 100) {
    faltas.push('Clasf pide una descripcion de al menos 100 caracteres');
  }
  if (!(settings.contactEmail || listing.agent?.email)) {
    faltas.push('Clasf exige un correo de contacto');
  }
  return faltas;
}

function renderClasf(
  listings: PortalListing[],
  settings: Record<string, string>,
): string {
  const ads = listings
    .filter((l) => clasfProblems(l, settings).length === 0)
    .flatMap((listing) =>
      operations(listing).map((op) => {
        const [branch, kind] = CLASF_BRANCH[listing.propertyTypeId] ?? [
          'otros inmuebles',
          'otros',
        ];
        const verb = op === 'sale' ? 'venta' : 'alquiler';
        const price = op === 'sale' ? listing.salePrice : listing.rentPrice;
        const phone = settings.contactPhone || listing.agent?.phone || '';
        const lines = [
          // `url` es el identificador unico del anuncio para Clasf.
          tag(
            'url',
            op === 'sale' ? listing.publicUrl : `${listing.publicUrl}?arriendo`,
          ),
          tag('title', listing.title),
          tag('description', listing.description),
          tag('email', settings.contactEmail || listing.agent?.email),
          tag('category', 'Inmobiliaria'),
          tag('subcategory', capitalize(branch)),
          tag('subcategory2', `Alquiler venta ${kind}`),
          tag('subcategory3', `${capitalize(verb)} de ${kind}`),
          price != null ? `<price>${Math.round(price)}</price>` : null,
          tag('contact', phone),
          tag('city', listing.cityName),
          tag('province', listing.regionName),
          listing.images.length
            ? `<pictures>${listing.images
                .slice(0, 20)
                .map((url) => tag('url_img', url))
                .join('')}</pictures>`
            : null,
        ];
        return `  <ad>\n    ${lines.filter(Boolean).join('\n    ')}\n  </ad>`;
      }),
    );
  return `<?xml version="1.0" encoding="utf-8"?>\n<ads>\n${ads.join('\n')}\n</ads>\n`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
