import { randomBytes } from 'node:crypto';
import { PublicationState } from '../domain/property-publication.entity';
import { FincaraizConnector } from '../connectors/fincaraiz.connector';
import type { ConnectorContext, MappedLocation } from './connector';
import { renderFeed } from './feed-xml';
import { jpgUrl, listingHash, type PortalListing } from './listing';
import { decryptSecrets, encryptSecrets } from './secrets';

/**
 * Lo que se puede romper sin que nadie lo vea hasta que un portal rechaza el
 * anuncio: el cifrado de las credenciales, las URLs de las fotos, el XML de
 * los agregadores y la traduccion al formato de Fincaraiz.
 */

const API = 'https://api.serrano.test/api/v1';

function listing(overrides: Partial<PortalListing> = {}): PortalListing {
  return {
    id: 'p1',
    code: '10232957',
    wasiId: 10232957,
    title: 'APARTAMENTO EN VENTA EN CABECERA',
    description: 'Tres alcobas, balcon y vista.',
    forSale: true,
    forRent: false,
    salePrice: 480_000_000,
    rentPrice: null,
    maintenanceFee: 420_000,
    currency: 'COP',
    propertyTypeId: 2,
    propertyTypeName: 'Apartamento',
    countryName: 'Colombia',
    regionId: 29,
    regionName: 'Santander',
    cityId: 105,
    cityName: 'Bucaramanga',
    zoneId: 7,
    zoneName: 'Cabecera del Llano',
    address: 'Carrera 35 # 48-20',
    showExactLocation: true,
    latitude: 7.1193,
    longitude: -73.1098,
    area: 98.5,
    builtArea: 98.5,
    privateArea: 92,
    bedrooms: 3,
    bathrooms: 2,
    garages: 1,
    floor: 8,
    stratum: 5,
    condition: 'USED',
    buildingYear: 2020,
    features: [
      { id: 32, name: 'Piscina' },
      { id: 104, name: 'Admite mascotas' },
    ],
    images: [`${API}/public/portal-images/properties/a/b-l.jpg`],
    videoUrl: null,
    tourUrl: null,
    publicUrl: 'https://serrano.test/apartamento/10232957',
    outstanding: false,
    publishable: true,
    blockers: [],
    agent: {
      name: 'Diana',
      email: 'diana@serrano.test',
      phone: '3242538173',
      whatsapp: '3242538173',
    },
    ...overrides,
  };
}

function ctx(location: MappedLocation | null): ConnectorContext {
  return {
    portalId: 16,
    portalName: 'Fincaraiz',
    credentials: { apiKey: 'k' },
    settings: { clientId: 'client-uuid' },
    sandbox: true,
    callbackUrl: `${API}/public/portal-callbacks/16/token`,
    saveSetting: () => Promise.resolve(),
    location: () => location,
  };
}

describe('credenciales cifradas', () => {
  const key = randomBytes(32);

  it('vuelven tal cual con la misma clave', () => {
    const payload = encryptSecrets(key, { apiKey: 'secreta', user: 'u' });
    expect(payload).not.toContain('secreta');
    expect(decryptSecrets(key, payload)).toEqual({
      apiKey: 'secreta',
      user: 'u',
    });
  });

  it('no se leen con otra clave', () => {
    const payload = encryptSecrets(key, { apiKey: 'secreta' });
    expect(() => decryptSecrets(randomBytes(32), payload)).toThrow();
  });
});

describe('fotos en JPG para los portales', () => {
  const pid = '263f2ce8-0000-4000-8000-000000000001';
  const img = 'f6c4a43b-0000-4000-8000-000000000002';

  it('cambia el WebP por la ruta de conversion', () => {
    expect(jpgUrl(API, `/media/properties/${pid}/${img}-l.webp`)).toBe(
      `${API}/public/portal-images/properties/${pid}/${img}-l.jpg`,
    );
  });

  it('lleva la version al nombre: hay portales que tiran la query', () => {
    expect(jpgUrl(API, `/media/properties/${pid}/${img}-l.webp?r=abc12`)).toBe(
      `${API}/public/portal-images/properties/${pid}/${img}-l.abc12.jpg`,
    );
  });

  it('no inventa rutas para lo que no es una foto de inmueble', () => {
    expect(jpgUrl(API, '/media/../../etc/passwd')).toBeNull();
  });
});

describe('huella del anuncio', () => {
  it('cambia con el precio y no con si se puede publicar', () => {
    const a = listing();
    expect(listingHash({ ...a, publishable: false, blockers: ['x'] })).toBe(
      listingHash(a),
    );
    expect(listingHash({ ...a, salePrice: 1 })).not.toBe(listingHash(a));
  });
});

describe('feed de los agregadores', () => {
  it('escapa el texto y separa venta y arriendo', () => {
    const xml = renderFeed(
      [
        listing({
          description: 'Texto con ]]> dentro',
          forRent: true,
          rentPrice: 2_500_000,
        }),
      ],
      {},
    );
    expect(xml).toContain('<id><![CDATA[10232957]]></id>');
    expect(xml).toContain('<id><![CDATA[10232957-A]]></id>');
    expect(xml).toContain('<price period="monthly">2500000</price>');
    expect(xml).toContain(']]]]><![CDATA[>');
    expect(xml).not.toContain('Texto con ]]> dentro');
  });
});

describe('feed de Clasf', () => {
  it('usa su formato y deja fuera lo que Clasf rechazaria', () => {
    const larga =
      'Apartamento amplio con balcon, vista a la ciudad, cocina integral, dos baños y parqueadero cubierto en conjunto cerrado.';
    const xml = renderFeed(
      [
        listing({ description: larga }),
        listing({ code: '2', publicUrl: 'https://serrano.test/x/2' }),
      ],
      { format: 'clasf' },
    );
    expect(xml).toContain('<ads>');
    expect(xml).toContain(
      '<subcategory3><![CDATA[Venta de apartamentos]]></subcategory3>',
    );
    expect(xml).toContain('<email><![CDATA[diana@serrano.test]]></email>');
    // El segundo tiene una descripcion corta: Clasf la rechazaria.
    expect(xml).not.toContain('serrano.test/x/2');
  });
});

describe('Fincaraiz', () => {
  const connector = new FincaraizConnector();
  const barrio: MappedLocation = {
    externalId: 'barrio-uuid',
    externalName: 'Cabecera del Llano',
    extra: {},
    level: 'zone',
    verified: true,
  };

  it('no deja salir un inmueble sin barrio emparejado', () => {
    expect(connector.validate(listing(), ctx(null)).join(' ')).toMatch(
      /no esta emparejada/,
    );
    expect(connector.validate(listing(), ctx(barrio))).toEqual([]);
  });

  it('crea y deja la tarea pendiente de confirmar', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = global.fetch;
    global.fetch = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes('/listing?search=')
        ? { results: [] }
        : { task: { id: 'task-1', status: 'READY' } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    try {
      const outcome = await connector.upsert(ctx(barrio), listing(), {
        externalId: null,
        transactionId: null,
      });
      expect(outcome).toMatchObject({
        state: PublicationState.PENDING,
        transactionId: 'create:task-1',
      });
      const post = calls.find((c) => c.init.method === 'POST')!;
      expect(post.url).toContain('api-integrators.frcol.io');
      const [payload] = JSON.parse(post.init.body as string) as Record<
        string,
        unknown
      >[];
      expect(payload).toMatchObject({
        external_code: '10232957',
        client_id: 'client-uuid',
        offer: 'sell',
        property_type: 'apartment',
        stratum: 5,
        rooms: 3,
        locations: { location_main_id: 'barrio-uuid', view_map: 0 },
      });
      // Piscina → 17; "Admite mascotas" no tiene categoria y no viaja.
      expect(payload.categories).toEqual([17]);
      const headers = post.init.headers as Record<string, string>;
      expect(headers.apikey).toBe('k');
    } finally {
      global.fetch = original;
    }
  });
});
