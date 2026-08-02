import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CatalogService } from '../catalog/catalog.service';
import { PublicService } from '../public/public.service';
import type { Property } from '../properties/domain/property.entity';
import type { PublicProperty } from '../public/public.service';
import type { ToolSpec } from './chat-provider';

/**
 * A que puede hablar el asistente.
 *
 * `GLOBAL` es el chat que flota en todo el sitio: puede buscar en el inventario.
 * `PROPERTY` es el chat abierto desde una ficha: queda atado a ESE inmueble y no
 * puede buscar otros — si el visitante pregunta por otros, la herramienta
 * `ir_al_buscador` avisa al front, que lo lleva a la portada y abre un hilo
 * nuevo.
 */
export type AssistantScope =
  { kind: 'GLOBAL' } | { kind: 'PROPERTY'; code: string };

/**
 * El resultado de ejecutar una herramienta.
 *
 * `forModel` es lo unico que ve el modelo: JSON compacto salido de la base, del
 * que redacta su respuesta. `card` viaja al navegador para pintar algo bonito
 * (una galeria, una tarjeta de inmueble, un selector de horas) sin depender de
 * que el modelo describa bien una foto. `action` es una orden para el front
 * (navegar, resetear). El modelo nunca fabrica ninguno de los tres: salen de
 * aqui.
 */
export interface ToolResult {
  forModel: unknown;
  card?: AssistantCard;
  action?: AssistantAction;
}

export type AssistantCard =
  | { type: 'properties'; items: PropertyCardView[] }
  | { type: 'property'; item: PropertyCardView }
  | { type: 'gallery'; code: string; title: string; images: GalleryImage[] }
  | { type: 'slots'; code: string; days: SlotDay[] }
  | { type: 'booked'; code: string; startsAt: string; endsAt: string };

export type AssistantAction = { type: 'go_to_search'; reason?: string };

interface GalleryImage {
  url: string;
  urlLarge: string;
  description: string | null;
}

interface SlotDay {
  date: string;
  slots: { startsAt: string; endsAt: string }[];
}

/** La vista de un inmueble para la tarjeta del chat: lo justo para reconocerlo. */
export interface PropertyCardView {
  code: string;
  title: string;
  type: string | null;
  city: string | null;
  zone: string | null;
  salePrice: number | null;
  rentPrice: number | null;
  currency: string;
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  cover: string | null;
  availability: string;
  path: string;
}

const AVAILABILITY_ES: Record<string, string> = {
  AVAILABLE: 'Disponible',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  RENTED: 'Arrendado',
  WITHDRAWN: 'Retirado',
};

const CONDITION_ES: Record<string, string> = {
  NEW: 'Nuevo',
  USED: 'Usado',
  PROJECT: 'Sobre planos',
  UNDER_CONSTRUCTION: 'En construcción',
};

/** Cuántos inmuebles y cuántas fotos como mucho entran en una respuesta. */
const MAX_RESULTS = 8;
const MAX_IMAGES = 12;

/**
 * Las herramientas del asistente.
 *
 * Todas son de lectura sobre los mismos servicios que ya sirven a la web
 * publica —asi que respetan lo publicado y nada mas—, salvo `agendar_visita`,
 * que escribe y por eso solo existe en el scope de una ficha y con la misma
 * ruta que el formulario de visita.
 */
@Injectable()
export class AssistantTools {
  private readonly logger = new Logger(AssistantTools.name);

  constructor(
    private readonly properties: PublicService,
    private readonly catalog: CatalogService,
    private readonly config: AppConfigService,
  ) {}

  /** Las herramientas que se ofrecen al modelo, segun donde este el visitante. */
  specs(scope: AssistantScope): ToolSpec[] {
    if (scope.kind === 'PROPERTY') {
      return [
        FICHA_SPEC_LOCKED,
        IMAGENES_SPEC_LOCKED,
        DISPONIBILIDAD_SPEC_LOCKED,
        AGENDAR_SPEC_LOCKED,
        IR_AL_BUSCADOR_SPEC,
      ];
    }
    return [BUSCAR_SPEC, FICHA_SPEC, IMAGENES_SPEC, DISPONIBILIDAD_SPEC];
  }

  /**
   * Ejecuta una herramienta. El scope se impone aqui: en una ficha, el codigo
   * lo pone el servidor y se ignora el que venga en los argumentos, de modo que
   * el modelo no puede colarse a otro inmueble aunque lo intente.
   */
  async execute(
    scope: AssistantScope,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const lockedCode = scope.kind === 'PROPERTY' ? scope.code : undefined;

    switch (name) {
      case 'buscar_inmuebles':
        if (scope.kind !== 'GLOBAL') {
          return {
            forModel: {
              error:
                'La búsqueda no está disponible aquí. Usa ir_al_buscador si el visitante quiere ver otros inmuebles.',
            },
          };
        }
        return this.buscar(args);

      case 'ficha_inmueble':
        return this.ficha(lockedCode ?? str(args.codigo));

      case 'imagenes_inmueble':
        return this.imagenes(lockedCode ?? str(args.codigo));

      case 'disponibilidad_visita':
        return this.disponibilidad(
          lockedCode ?? str(args.codigo),
          str(args.desde),
          str(args.hasta),
        );

      case 'agendar_visita':
        if (!lockedCode) {
          return {
            forModel: {
              error:
                'Solo se puede agendar desde la ficha de un inmueble concreto.',
            },
          };
        }
        return this.agendar(lockedCode, args);

      case 'ir_al_buscador':
        return {
          forModel: {
            ok: true,
            note: 'Se avisó al sitio para llevar al visitante al buscador y abrir un hilo nuevo.',
          },
          action: { type: 'go_to_search', reason: str(args.motivo) },
        };

      default:
        return { forModel: { error: `Herramienta desconocida: ${name}` } };
    }
  }

  // --- implementaciones ---------------------------------------------------

  private async buscar(args: Record<string, unknown>): Promise<ToolResult> {
    const [cityId, zoneId, typeId] = await Promise.all([
      this.resolveCity(str(args.ciudad)),
      this.resolveZone(str(args.zona), str(args.ciudad)),
      this.resolveType(str(args.tipo)),
    ]);

    const operacion = str(args.operacion)?.toLowerCase();
    const page = await this.properties.searchProperties({
      q: str(args.texto),
      cityId,
      zoneId,
      propertyTypeId: typeId,
      minPrice: num(args.precioMin),
      maxPrice: num(args.precioMax),
      minArea: num(args.areaMin),
      bedrooms: int(args.alcobasMin),
      bathrooms: int(args.banosMin),
      forSale: operacion === 'venta' ? 'true' : undefined,
      forRent: operacion === 'arriendo' ? 'true' : undefined,
      forTransfer: operacion === 'permuta' ? 'true' : undefined,
      sort: sortOf(str(args.orden)),
      limit: MAX_RESULTS,
    });

    const items = page.data.map((p) => cardView(p));
    return {
      forModel: {
        total: page.meta.total,
        mostrados: items.length,
        inmuebles: items.map(forModelCard),
        nota:
          page.meta.total > items.length
            ? `Hay ${page.meta.total} en total; se muestran los primeros ${items.length}. Sugiere afinar (zona, precio, alcobas) si son muchos.`
            : undefined,
      },
      card: items.length ? { type: 'properties', items } : undefined,
    };
  }

  private async ficha(code?: string): Promise<ToolResult> {
    if (!code) return { forModel: { error: 'Falta el código del inmueble.' } };
    const property = await this.loadOrNull(code);
    if (!property) return notFound(code);

    const view = cardView(property);
    return {
      forModel: fullView(property),
      card: { type: 'property', item: view },
    };
  }

  private async imagenes(code?: string): Promise<ToolResult> {
    if (!code) return { forModel: { error: 'Falta el código del inmueble.' } };
    const property = await this.loadOrNull(code);
    if (!property) return notFound(code);

    const images = [...(property.images ?? [])]
      .sort((a, b) => a.position - b.position)
      .slice(0, MAX_IMAGES)
      .map((img) => ({
        url: img.url,
        urlLarge: img.urlLarge,
        description: img.description,
      }));

    return {
      forModel: {
        codigo: property.code,
        totalFotos: property.images?.length ?? 0,
        mostradas: images.length,
        nota: images.length
          ? 'Las fotos ya se le muestran al visitante en el chat; no hace falta pegar enlaces, solo coméntalas.'
          : 'Este inmueble no tiene fotos cargadas. Ofrécele agendar una visita o hablar con el asesor.',
      },
      card: images.length
        ? {
            type: 'gallery',
            code: property.code,
            title: property.title,
            images,
          }
        : undefined,
    };
  }

  private async disponibilidad(
    code?: string,
    desde?: string,
    hasta?: string,
  ): Promise<ToolResult> {
    if (!code) return { forModel: { error: 'Falta el código del inmueble.' } };

    const from = isoDate(desde) ?? today();
    const to = isoDate(hasta) ?? addDays(today(), 21);

    // `let` sin anotar lo convertia en `any` y arrastraba el tipo por todo lo
    // que viene detras. Con `catch` sobre la promesa se conserva el inferido.
    const days = await this.properties
      .availabilityFor(code, from, to)
      .catch(() => null);
    if (!days) return notFound(code);

    const open = days
      .filter((d) => d.available && d.slots.length)
      .slice(0, 10)
      .map((d) => ({
        date: d.date,
        slots: d.slots.slice(0, 8).map((s) => ({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
      }));

    return {
      forModel: {
        codigo: code,
        rango: { desde: from, hasta: to },
        antelacionMinimaHoras: this.config.publicBookingLeadHours,
        diasConCupo: open.map((d) => ({
          fecha: d.date,
          horas: d.slots.map((s) => s.startsAt),
        })),
        nota: open.length
          ? 'Confirma con el visitante día y hora exactos, pídele nombre y teléfono, y usa agendar_visita.'
          : 'No hay cupos en ese rango. Ofrece otro rango o dejar los datos para que un asesor lo llame.',
      },
      card: open.length ? { type: 'slots', code, days: open } : undefined,
    };
  }

  private async agendar(
    code: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const property = await this.loadOrNull(code);
    if (!property) return notFound(code);

    const nombre = str(args.nombre)?.trim();
    const telefono = str(args.telefono)?.trim();
    const inicio = str(args.inicio)?.trim();
    if (!nombre || !telefono || !inicio) {
      return {
        forModel: {
          error:
            'Para agendar necesito nombre, teléfono y la hora exacta (inicio en ISO). Pídeselos antes de volver a llamar.',
        },
      };
    }

    try {
      const result = await this.properties.bookVisit({
        propertyId: property.id,
        startsAt: inicio,
        firstName: nombre,
        lastName: str(args.apellido)?.trim() || undefined,
        phone: telefono,
        email: str(args.email)?.trim() || undefined,
        message: str(args.mensaje)?.trim() || undefined,
      });

      return {
        forModel: {
          ok: true,
          confirmacion: result.message,
          inicio: result.startsAt,
          codigo: result.propertyCode,
          nota: 'Confírmale al visitante con calidez y dile que un asesor le llamará antes de la cita.',
        },
        card: {
          type: 'booked',
          code: result.propertyCode,
          startsAt: String(result.startsAt),
          endsAt: String(result.endsAt),
        },
      };
    } catch (error) {
      // Los mensajes de la API van en castellano y pensados para leerse: el
      // modelo los reformula ("esa franja se ocupó, ¿probamos otra?").
      const message =
        error instanceof Error ? error.message : 'No se pudo agendar.';
      this.logger.warn(`agendar_visita falló para ${code}: ${message}`);
      return {
        forModel: {
          error: message,
          nota: 'Explícale con amabilidad y ofrécele otra hora del calendario.',
        },
      };
    }
  }

  // --- utilidades ---------------------------------------------------------

  private async loadOrNull(code: string): Promise<PublicProperty | null> {
    try {
      return await this.properties.propertyByCodeQuiet(code);
    } catch {
      return null;
    }
  }

  private async resolveCity(name?: string): Promise<number | undefined> {
    if (!name) return undefined;
    const cities = await this.catalog.listCities();
    return matchByName(cities, name)?.id;
  }

  private async resolveZone(
    name?: string,
    cityName?: string,
  ): Promise<number | undefined> {
    if (!name) return undefined;
    const cityId = await this.resolveCity(cityName);
    const zones = await this.catalog.listZones(cityId);
    return matchByName(zones, name)?.id;
  }

  private async resolveType(name?: string): Promise<number | undefined> {
    if (!name) return undefined;
    const types = await this.catalog.listPropertyTypes();
    return matchByName(types, name)?.id;
  }
}

// --- mapeos -----------------------------------------------------------------

function cardView(p: Property): PropertyCardView {
  const cover =
    p.images?.find((img) => img.isMain)?.url ?? p.images?.[0]?.url ?? null;
  return {
    code: p.code,
    title: p.title,
    type: p.propertyType?.name ?? null,
    city: p.city?.name ?? null,
    zone: p.zone?.name ?? null,
    salePrice: p.salePrice,
    rentPrice: p.rentPrice,
    currency: p.currency?.iso ?? 'COP',
    area: p.builtArea ?? p.area,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    garages: p.garages,
    cover,
    availability: AVAILABILITY_ES[p.availability] ?? p.availability,
    path: propertyPath(p),
  };
}

/** Lo que ve el modelo de una tarjeta: sin rutas ni urls, solo hechos. */
function forModelCard(v: PropertyCardView) {
  return {
    codigo: v.code,
    titulo: v.title,
    tipo: v.type,
    ciudad: v.city,
    zona: v.zone,
    precioVenta: v.salePrice,
    precioArriendo: v.rentPrice,
    moneda: v.currency,
    area: v.area,
    alcobas: v.bedrooms,
    banos: v.bathrooms,
    garajes: v.garages,
    estado: v.availability,
  };
}

/** La ficha completa que ve el modelo para responder cualquier detalle. */
function fullView(p: PublicProperty) {
  const operacion: string[] = [];
  if (p.forSale) operacion.push('venta');
  if (p.forRent) operacion.push('arriendo');
  if (p.forTemporaryRent) operacion.push('arriendo temporal');
  if (p.forTransfer) operacion.push('permuta');

  return {
    codigo: p.code,
    titulo: p.title,
    tipo: p.propertyType?.name ?? null,
    operacion,
    estado: AVAILABILITY_ES[p.availability] ?? p.availability,
    ciudad: p.city?.name ?? null,
    zona: p.zone?.name ?? null,
    departamento: p.city?.region?.name ?? null,
    direccion: p.address,
    precioVenta: p.salePrice,
    precioArriendo: p.rentPrice,
    administracion: p.maintenanceFee,
    moneda: p.currency?.iso ?? 'COP',
    area: p.area,
    areaConstruida: p.builtArea,
    areaPrivada: p.privateArea,
    alcobas: p.bedrooms,
    banos: p.bathrooms,
    garajes: p.garages,
    piso: p.floor,
    estrato: p.stratum,
    estado_inmueble: p.condition
      ? (CONDITION_ES[p.condition] ?? p.condition)
      : null,
    anoConstruccion: p.buildingYear,
    proyecto: p.family
      ? { nombre: p.family.name, tipologia: p.unitType ?? null }
      : null,
    caracteristicas: (p.features ?? []).map((f) => f.name),
    totalFotos: p.images?.length ?? 0,
    tieneVideo: Boolean(p.videoUrl),
    tieneRecorrido360: Boolean(p.tourUrl),
    observaciones: p.observations?.trim()?.slice(0, 1200) ?? null,
    asesor: p.agent
      ? {
          nombre: p.agent.fullName,
          telefono: p.agent.cellPhone,
          whatsapp: p.agent.hasWhatsapp,
        }
      : null,
  };
}

/**
 * La ruta de la ficha: `/<tipo>-en-<zona>/<code>`.
 *
 * DOS segmentos, no tres. La web declara la ficha como `:slug/:code`, asi que
 * un `/venta/<slug>/<code>` no encaja con ninguna ruta y el visitante acaba en
 * la portada — con la tarjeta del inmueble delante y sin llegar nunca a el.
 * Tampoco lo reconoce el patron de nginx que sirve la cabecera del inmueble,
 * asi que ademas se compartiria sin foto ni precio.
 */
function propertyPath(p: Property): string {
  const parts = [p.propertyType?.name, p.zone?.name ?? p.city?.name]
    .filter(Boolean)
    .map(slugify)
    .join('-en-');
  const slug = parts || 'inmueble';
  return `/${slug}/${p.code}`;
}

// --- especificaciones de las herramientas -----------------------------------

const CODE_PARAM = {
  codigo: {
    type: 'string',
    description: 'Código del inmueble, por ejemplo "10086685".',
  },
};

const BUSCAR_SPEC: ToolSpec = {
  name: 'buscar_inmuebles',
  description:
    'Busca inmuebles publicados por ciudad, zona/barrio, tipo, precio, alcobas y baños. ' +
    'Usa esto cuando el visitante describe lo que busca. Devuelve como mucho 8; si hay más, sugiere afinar.',
  parameters: {
    type: 'object',
    properties: {
      texto: {
        type: 'string',
        description: 'Texto libre: título, dirección o código.',
      },
      ciudad: {
        type: 'string',
        description: 'Bucaramanga, Floridablanca, Girón, Piedecuesta…',
      },
      zona: { type: 'string', description: 'Barrio o zona, p. ej. Cabecera.' },
      tipo: { type: 'string', description: 'Apartamento, Casa, Lote, Local…' },
      operacion: { type: 'string', enum: ['venta', 'arriendo', 'permuta'] },
      precioMin: { type: 'number' },
      precioMax: { type: 'number' },
      areaMin: { type: 'number', description: 'Área mínima en m².' },
      alcobasMin: { type: 'integer' },
      banosMin: { type: 'integer' },
      orden: {
        type: 'string',
        enum: ['recientes', 'precio_asc', 'precio_desc', 'area_desc'],
      },
    },
  },
};

const FICHA_SPEC: ToolSpec = {
  name: 'ficha_inmueble',
  description:
    'Trae todos los datos de un inmueble por su código: precio, área, alcobas, baños, estrato, ' +
    'garajes, piso, año, proyecto/conjunto, características (ascensor, etc.), administración y asesor. ' +
    'Úsalo para responder cualquier detalle concreto.',
  parameters: { type: 'object', properties: CODE_PARAM, required: ['codigo'] },
};

const IMAGENES_SPEC: ToolSpec = {
  name: 'imagenes_inmueble',
  description:
    'Muestra las fotos del inmueble en el chat. Úsalo cuando pidan ver más imágenes, fotos o videos.',
  parameters: { type: 'object', properties: CODE_PARAM, required: ['codigo'] },
};

const DISPONIBILIDAD_SPEC: ToolSpec = {
  name: 'disponibilidad_visita',
  description:
    'Consulta qué días y horas hay cupo para visitar el inmueble. Devuelve las franjas libres.',
  parameters: {
    type: 'object',
    properties: {
      ...CODE_PARAM,
      desde: {
        type: 'string',
        description: 'Fecha inicial YYYY-MM-DD (opcional).',
      },
      hasta: {
        type: 'string',
        description: 'Fecha final YYYY-MM-DD (opcional).',
      },
    },
    required: ['codigo'],
  },
};

// En una ficha, el código lo pone el servidor: las herramientas no lo piden,
// para que el modelo no pueda apuntar a otro inmueble.
const LOCKED_PARAMS = { type: 'object', properties: {} };

const FICHA_SPEC_LOCKED: ToolSpec = {
  name: 'ficha_inmueble',
  description:
    'Trae todos los datos del inmueble que el visitante está viendo: precio, área, alcobas, baños, ' +
    'estrato, garajes, piso, año, proyecto/conjunto, características (ascensor…), administración y asesor.',
  parameters: LOCKED_PARAMS,
};

const IMAGENES_SPEC_LOCKED: ToolSpec = {
  name: 'imagenes_inmueble',
  description:
    'Muestra en el chat las fotos del inmueble que el visitante está viendo. Úsalo si pide ver más imágenes o fotos.',
  parameters: LOCKED_PARAMS,
};

const DISPONIBILIDAD_SPEC_LOCKED: ToolSpec = {
  name: 'disponibilidad_visita',
  description: 'Consulta días y horas con cupo para visitar este inmueble.',
  parameters: {
    type: 'object',
    properties: {
      desde: {
        type: 'string',
        description: 'Fecha inicial YYYY-MM-DD (opcional).',
      },
      hasta: {
        type: 'string',
        description: 'Fecha final YYYY-MM-DD (opcional).',
      },
    },
  },
};

const AGENDAR_SPEC_LOCKED: ToolSpec = {
  name: 'agendar_visita',
  description:
    'Agenda una visita a este inmueble. Llama SOLO cuando ya tengas nombre, teléfono y una hora exacta ' +
    'que el visitante haya elegido de la disponibilidad. Si falta algo, pídelo antes.',
  parameters: {
    type: 'object',
    properties: {
      inicio: {
        type: 'string',
        description:
          'Inicio exacto en ISO 8601, tomado de disponibilidad_visita.',
      },
      nombre: { type: 'string' },
      apellido: { type: 'string' },
      telefono: { type: 'string' },
      email: { type: 'string' },
      mensaje: { type: 'string', description: 'Nota opcional para el asesor.' },
    },
    required: ['inicio', 'nombre', 'telefono'],
  },
};

const IR_AL_BUSCADOR_SPEC: ToolSpec = {
  name: 'ir_al_buscador',
  description:
    'Aquí solo puedes hablar de ESTE inmueble. Si el visitante quiere ver o comparar OTROS inmuebles, ' +
    'llama a esta herramienta: el sitio lo llevará al buscador y abrirá una conversación nueva. ' +
    'Avísale antes con calidez de que lo llevas allí para poder ayudarle con el resto.',
  parameters: {
    type: 'object',
    properties: {
      motivo: {
        type: 'string',
        description: 'Qué pidió el visitante, en pocas palabras.',
      },
    },
  },
};

// --- coerciones y texto -----------------------------------------------------

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function int(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : Math.trunc(n);
}

function sortOf(value?: string): string | undefined {
  switch (value) {
    case 'precio_asc':
      return 'price_asc';
    case 'precio_desc':
      return 'price_desc';
    case 'area_desc':
      return 'area_desc';
    case 'recientes':
      return 'recent';
    default:
      return undefined;
  }
}

function notFound(code: string): ToolResult {
  return {
    forModel: {
      error: `No encontré un inmueble publicado con el código ${code}. Puede que ya no esté disponible.`,
    },
  };
}

/** Coincidencia por nombre tolerante a tildes y mayúsculas: contains normalizado. */
function matchByName<T extends { id: number; name: string }>(
  items: T[],
  query: string,
): T | undefined {
  const q = normalize(query);
  return (
    items.find((item) => normalize(item.name) === q) ??
    items.find((item) => normalize(item.name).includes(q)) ??
    items.find((item) => q.includes(normalize(item.name)))
  );
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function slugify(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  return match ? match[0] : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
