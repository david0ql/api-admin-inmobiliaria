import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Paginated } from '../../shared/http/paginated';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { Client } from '../crm/domain/client.entity';
import { Agent } from '../iam/domain/agent.entity';
import { AgentStatus } from '../iam/domain/role.enum';
import { PipelinesService } from '../crm/pipelines.service';
import {
  InterestRole,
  PropertyInterest,
} from '../crm/domain/property-interest.entity';
import { LeadSource } from '../crm/domain/lead-source.entity';
import { Property } from '../properties/domain/property.entity';
import { PropertyFamily } from '../properties/domain/property-family.entity';
import {
  Availability,
  PublicationStatus,
} from '../properties/domain/property.enums';
import { FamiliesService } from '../properties/families.service';
import { normalizePhone } from '../crm/clients.service';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '../scheduling/domain/appointment.entity';
import {
  AvailabilityService,
  type DayAvailability,
} from '../scheduling/availability.service';
import { BookingSettingsService } from '../scheduling/booking-settings.service';
import {
  ConsignmentRequest,
  ConsignmentStatus,
  type ConsignmentFile,
} from './domain/consignment-request.entity';
import type { BookVisitDto, CreateConsignmentDto } from './dto/consignment.dto';
import type { SearchPublicProjectsDto } from './dto/public-projects.dto';
import type { SearchPublicPropertiesDto } from './dto/public-search.dto';

/** Solo se enseña fuera lo publicado; el resto ni existe para la web. */
const VISIBLE = [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING];

/** Los desplegables que llevan cuenta. */
export type Faceta =
  'countries' | 'regions' | 'cities' | 'zones' | 'propertyTypes';

export interface FacetOption {
  id: number;
  name: string;
  count: number;
}

export type FacetResult = Record<Faceta, FacetOption[]>;

/** Un proyecto del listado publico, con sus cifras ya calculadas. */
export type PublicFamilySummary = Awaited<
  ReturnType<PublicService['listFamilies']>
>['data'][number];

/** Cada cuanto se vuelve a leer el grupo del que se rota. */
const POOL_TTL_MS = 10 * 60 * 1000;

/**
 * Cuantos ordenes distintos se dejan hechos.
 *
 * Sesenta, no tres: con pocos, quien entra dos veces seguidas reconoce la
 * misma tanda y el efecto se pierde. Cuestan sesenta recorridos de una lista de
 * veinticuatro cada diez minutos, que es nada, y se sirven de memoria.
 */
const VARIANTES = 60;

/** Sesenta recortes distintos del mismo grupo, calculados de una vez. */
function rotaciones<T>(pool: T[], tamano: number): T[][] {
  if (!pool.length) return [];
  return Array.from({ length: VARIANTES }, () =>
    barajar(pool).slice(0, tamano),
  );
}

/** Fisher-Yates: cada orden posible sale con la misma probabilidad. */
function barajar<T>(items: T[]): T[] {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * El asesor tal y como puede verlo un visitante: los datos con los que ya
 * atiende el telefono, y nada mas. Ni rol, ni estado, ni ultimo acceso.
 */
export interface PublicAgent {
  fullName: string;
  email: string;
  cellPhone: string | null;
  hasWhatsapp: boolean;
  photoUrl: string | null;
}

export type PublicProperty = Property & { agent: PublicAgent | null };

/** Proyecto de cara al listado: la familia mas lo que resume su oferta. */
export type PublicFamily = PropertyFamily & {
  unitTypeCount: number;
  availableUnits: number;
  fromPrice: number | null;
};

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(PropertyFamily)
    private readonly families: Repository<PropertyFamily>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(PropertyInterest)
    private readonly interests: Repository<PropertyInterest>,
    @InjectRepository(LeadSource)
    private readonly sources: Repository<LeadSource>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(ConsignmentRequest)
    private readonly consignments: Repository<ConsignmentRequest>,
    private readonly familiesService: FamiliesService,
    private readonly availability: AvailabilityService,
    private readonly bookingSettings: BookingSettingsService,
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /** El grupo del que se rota y los ordenes ya hechos. Ver `homeProjects`. */
  private rotacionProyectos?: {
    hasta: number;
    variantes: PublicFamilySummary[][];
  };
  private turnoProyectos = 0;

  // --- inmuebles ---------------------------------------------------------

  async searchProperties(
    dto: SearchPublicPropertiesDto,
  ): Promise<Paginated<Property>> {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 24, 48);

    const qb = this.properties
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.family', 'family')
      .leftJoinAndSelect('property.images', 'image', 'image.is_main = true')
      .where('property.publication_status IN (:...visible)', {
        visible: VISIBLE,
      })
      .andWhere('property.availability = :available', {
        available: Availability.AVAILABLE,
      });

    this.aplicarFiltros(qb, dto);

    switch (dto.sort) {
      case 'price_asc':
        qb.orderBy('property.sale_price', 'ASC', 'NULLS LAST');
        break;
      case 'price_desc':
        qb.orderBy('property.sale_price', 'DESC', 'NULLS LAST');
        break;
      case 'area_desc':
        qb.orderBy('property.area', 'DESC', 'NULLS LAST');
        break;
      default:
        // Los destacados primero: es la palanca comercial de la agencia.
        // El rango va como columna calculada y no dentro del `orderBy`, porque
        // TypeORM parte la expresion por el primer punto creyendo que lo que
        // hay antes es un alias de tabla.
        qb.addSelect(
          'CASE WHEN property.publication_status = :outstanding THEN 0 ELSE 1 END',
          'featured_rank',
        )
          .setParameter('outstanding', PublicationStatus.OUTSTANDING)
          .orderBy('featured_rank', 'ASC')
          .addOrderBy('property.created_at', 'DESC');
    }
    qb.addOrderBy('property.id', 'DESC');

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return new Paginated(data, total, page, limit);
  }

  /**
   * Los filtros de la busqueda publica, en un solo sitio.
   *
   * `omitir` existe para las facetas: al contar cuantos inmuebles hay en cada
   * ciudad no se puede aplicar el filtro de ciudad, porque entonces las demas
   * ciudades saldrian todas a cero y el desplegable se quedaria con una sola
   * opcion. Cada faceta se cuenta contra los demas filtros, no contra si misma.
   */
  private aplicarFiltros(
    qb: SelectQueryBuilder<Property>,
    dto: SearchPublicPropertiesDto,
    omitir?: Faceta,
  ): void {
    if (dto.q?.trim()) {
      qb.andWhere('property.search_text LIKE :q', {
        q: `%${dto.q.trim().toLowerCase()}%`,
      });
    }
    /*
      Pais y departamento van contra la ciudad ya unida, no contra columnas del
      inmueble: la geografia cuelga de `city`, y el join ya esta hecho arriba
      para poder pintar el nombre en la tarjeta.
    */
    if (dto.countryId && omitir !== 'countries')
      qb.andWhere(
        // La ciudad no guarda el pais: cuelga del departamento, y este del
        // pais. La subconsulta evita meter otro join en la consulta principal,
        // que es la que tambien se usa para contar y paginar.
        'city.region_id IN (SELECT id FROM region WHERE country_id = :countryId)',
        { countryId: dto.countryId },
      );
    if (dto.regionId && omitir !== 'regions')
      qb.andWhere('city.region_id = :regionId', { regionId: dto.regionId });
    if (dto.cityId && omitir !== 'cities')
      qb.andWhere('property.city_id = :cityId', { cityId: dto.cityId });
    if (dto.zoneId && omitir !== 'zones')
      qb.andWhere('property.zone_id = :zoneId', { zoneId: dto.zoneId });
    if (dto.propertyTypeId && omitir !== 'propertyTypes') {
      qb.andWhere('property.property_type_id = :typeId', {
        typeId: dto.propertyTypeId,
      });
    }
    if (dto.familyId)
      qb.andWhere('property.family_id = :familyId', { familyId: dto.familyId });
    if (dto.minPrice)
      qb.andWhere('property.sale_price >= :minPrice', {
        minPrice: dto.minPrice,
      });
    if (dto.maxPrice)
      qb.andWhere('property.sale_price <= :maxPrice', {
        maxPrice: dto.maxPrice,
      });
    if (dto.bedrooms)
      qb.andWhere('property.bedrooms >= :bedrooms', { bedrooms: dto.bedrooms });
    if (dto.bathrooms)
      qb.andWhere('property.bathrooms >= :bathrooms', {
        bathrooms: dto.bathrooms,
      });
    if (dto.condition)
      qb.andWhere('property.condition = :condition', {
        condition: dto.condition,
      });
    if (dto.minArea)
      qb.andWhere('property.area >= :minArea', { minArea: dto.minArea });
    if (dto.maxArea)
      qb.andWhere('property.area <= :maxArea', { maxArea: dto.maxArea });
    if (dto.forRent === 'true') qb.andWhere('property.for_rent = true');
    if (dto.forSale === 'true') qb.andWhere('property.for_sale = true');
    if (dto.forTransfer === 'true') qb.andWhere('property.for_transfer = true');
  }

  /**
   * Los proyectos de la portada, rotando sin castigar la base.
   *
   * Enseñar siempre los mismos seis hace que el resto no exista para nadie que
   * vuelva. Pero barajar en SQL —`ORDER BY RANDOM()`— es una consulta nueva por
   * visita, y cada proyecto ademas arrastra el calculo de sus tipologias y su
   * rango de precio.
   *
   * Asi que se consulta UNA vez cada diez minutos, se guarda el grupo en
   * memoria y de ahi se sacan sesenta ordenes distintos ya hechos. Cada
   * peticion solo elige el siguiente: la base ve seis consultas por hora en
   * lugar de una por visitante, y aun asi quien recarga ve otros proyectos.
   */
  async homeProjects(limit = 6): Promise<PublicFamilySummary[]> {
    const ahora = Date.now();

    if (!this.rotacionProyectos || this.rotacionProyectos.hasta < ahora) {
      const pool = await this.listFamilies({ page: 1, limit: 24 });
      this.rotacionProyectos = {
        hasta: ahora + POOL_TTL_MS,
        variantes: rotaciones(pool.data, limit),
      };
    }

    const { variantes } = this.rotacionProyectos;
    if (!variantes.length) return [];
    // Por peticion y no por reloj: dos personas que entran en el mismo minuto
    // ven cosas distintas, que es lo que hace que el sitio parezca vivo.
    this.turnoProyectos = (this.turnoProyectos + 1) % variantes.length;
    return variantes[this.turnoProyectos];
  }

  /**
   * Cuantos inmuebles hay detras de cada opcion de los desplegables.
   *
   * Es lo que convierte el buscador en algo que se puede recorrer sin caer en
   * un cero: al elegir Floridablanca, los barrios y los tipos pasan a decir
   * cuantos hay EN Floridablanca, no en todo el inventario. Cada faceta se
   * cuenta contra los demas filtros y no contra si misma —ver `aplicarFiltros`—,
   * porque si no, elegir una ciudad dejaria a las demas en cero y ya no se
   * podria cambiar de idea sin borrar el filtro antes.
   *
   * Las cinco consultas son agrupaciones sobre 642 filas: salen en un par de
   * milisegundos y la respuesta ademas va cacheada.
   */
  async facets(dto: SearchPublicPropertiesDto): Promise<FacetResult> {
    const contar = async (
      faceta: Faceta,
      columna: string,
      etiqueta: string,
      joins: (qb: SelectQueryBuilder<Property>) => void,
    ) => {
      const qb = this.properties
        .createQueryBuilder('property')
        .where('property.publication_status IN (:...visible)', {
          visible: VISIBLE,
        })
        .andWhere('property.availability = :available', {
          available: Availability.AVAILABLE,
        });
      joins(qb);
      this.aplicarFiltros(qb, dto, faceta);

      const filas = await qb
        .select(columna, 'id')
        .addSelect(etiqueta, 'name')
        .addSelect('COUNT(property.id)', 'count')
        .groupBy(columna)
        .addGroupBy(etiqueta)
        .getRawMany<{
          id: number | null;
          name: string | null;
          count: string;
        }>();

      return filas
        .filter((f) => f.id !== null && f.name !== null)
        .map((f) => ({
          id: Number(f.id),
          name: f.name as string,
          count: Number(f.count),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    };

    const geo = (qb: SelectQueryBuilder<Property>) => {
      qb.innerJoin('property.city', 'city')
        .innerJoin('city.region', 'region')
        .innerJoin('region.country', 'country');
    };

    const [countries, regions, cities, zones, propertyTypes] =
      await Promise.all([
        contar('countries', 'country.id', 'country.name', geo),
        contar('regions', 'region.id', 'region.name', geo),
        contar('cities', 'city.id', 'city.name', geo),
        contar('zones', 'zone.id', 'zone.name', (qb) =>
          qb.innerJoin('property.zone', 'zone'),
        ),
        contar('propertyTypes', 'type.id', 'type.name', (qb) =>
          qb.innerJoin('property.propertyType', 'type'),
        ),
      ]);

    return { countries, regions, cities, zones, propertyTypes };
  }

  /**
   * La geografía que el buscador puede ofrecer: país, departamento y ciudad.
   *
   * Sale del inventario y no del catálogo. En las tablas hay 38 países y 943
   * departamentos porque el volcado traía el mundo entero, pero los 642
   * inmuebles están todos en Santander: un desplegable con 37 países que no
   * devuelven nada es peor que no tener el desplegable. Así, el día que se
   * publique algo en Cundinamarca, Cundinamarca aparece sola.
   *
   * Va con el número de inmuebles de cada sitio porque quien elige «Girón»
   * agradece saber que hay 74 antes de pulsar buscar.
   */
  async geography() {
    const rows = await this.properties
      .createQueryBuilder('property')
      .innerJoin('property.city', 'city')
      .innerJoin('city.region', 'region')
      .innerJoin('region.country', 'country')
      .select('country.id', 'countryId')
      .addSelect('country.name', 'countryName')
      .addSelect('region.id', 'regionId')
      .addSelect('region.name', 'regionName')
      .addSelect('city.id', 'cityId')
      .addSelect('city.name', 'cityName')
      .addSelect('COUNT(property.id)', 'count')
      .where('property.publication_status IN (:...visible)', {
        visible: VISIBLE,
      })
      .andWhere('property.availability = :available', {
        available: Availability.AVAILABLE,
      })
      .groupBy('country.id')
      .addGroupBy('country.name')
      .addGroupBy('region.id')
      .addGroupBy('region.name')
      .addGroupBy('city.id')
      .addGroupBy('city.name')
      .orderBy('city.name', 'ASC')
      .getRawMany<{
        countryId: number;
        countryName: string;
        regionId: number;
        regionName: string;
        cityId: number;
        cityName: string;
        count: string;
      }>();

    const countries = new Map<
      number,
      { id: number; name: string; count: number }
    >();
    const regions = new Map<
      number,
      { id: number; name: string; countryId: number; count: number }
    >();
    const cities = rows.map((row) => {
      const count = Number(row.count);

      const pais = countries.get(row.countryId) ?? {
        id: row.countryId,
        name: row.countryName,
        count: 0,
      };
      pais.count += count;
      countries.set(pais.id, pais);

      const depto = regions.get(row.regionId) ?? {
        id: row.regionId,
        name: row.regionName,
        countryId: row.countryId,
        count: 0,
      };
      depto.count += count;
      regions.set(depto.id, depto);

      return {
        id: row.cityId,
        name: row.cityName,
        regionId: row.regionId,
        countryId: row.countryId,
        count,
      };
    });

    const porNombre = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'es');

    return {
      countries: [...countries.values()].sort(porNombre),
      regions: [...regions.values()].sort(porNombre),
      cities,
    };
  }

  /**
   * Cuántos inmuebles visibles hay de cada tipo. Es lo que el menú de la web
   * enseña entre paréntesis — Apartamento (423) — y sin esto la web tenía que
   * sacarlo con una consulta por tipo.
   */
  async countsByPropertyType(): Promise<
    { propertyTypeId: number; total: number; forSale: number }[]
  > {
    const rows = await this.properties
      .createQueryBuilder('property')
      .select('property.property_type_id', 'propertyTypeId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE property.for_sale)', 'forSale')
      .where('property.publication_status IN (:...visible)', {
        visible: VISIBLE,
      })
      .andWhere('property.availability = :available', {
        available: Availability.AVAILABLE,
      })
      .andWhere('property.property_type_id IS NOT NULL')
      .groupBy('property.property_type_id')
      .getRawMany<{ propertyTypeId: number; total: string; forSale: string }>();

    // `COUNT` vuelve como bigint y el driver lo entrega en texto.
    return rows.map((row) => ({
      propertyTypeId: Number(row.propertyTypeId),
      total: Number(row.total),
      forSale: Number(row.forSale),
    }));
  }

  /** Ficha pública por código. El uuid no se expone fuera. */
  /**
   * La ficha pública.
   *
   * Ya NO cuenta la visita. Contarla aquí ataba el contador a la lectura, y eso
   * impedía cachear la página más visitada del sitio: cada visitante era una
   * consulta con imágenes, ciudad, zona, tipo y moneda solo para poder sumar
   * uno. Ahora la visita la registra la propia ficha al abrirse —ver
   * `registerVisit`—, que además cuenta mejor: mide páginas abiertas, no
   * llamadas a la API.
   */
  async propertyByCode(code: string): Promise<PublicProperty> {
    return this.propertyByCodeQuiet(code);
  }

  /**
   * Suma una visita.
   *
   * Va aparte de la lectura para que la ficha se pueda cachear. Es la señal de
   * interés más barata que tiene la agencia y no se quiere perder.
   */
  async registerVisit(code: string): Promise<void> {
    await this.properties.increment({ code }, 'visits', 1);
  }

  /**
   * La misma ficha, pero SIN contar la visita.
   *
   * La usa el asistente: en un mismo hilo puede consultar el inmueble varias
   * veces —precio, luego fotos, luego disponibilidad—, y cada consulta no es
   * una visita nueva. El contador de `visits` mide interés real desde la ficha,
   * y triplicarlo por cada charla lo volveria ruido.
   */
  async propertyByCodeQuiet(code: string): Promise<PublicProperty> {
    const property = await this.loadPublicProperty(code);
    return Object.assign(property, {
      agent: await this.publicAgent(property.assignedAgentId),
    });
  }

  private async loadPublicProperty(code: string): Promise<Property> {
    const property = await this.properties
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('city.region', 'region')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.family', 'family')
      .leftJoinAndSelect('property.features', 'features')
      .leftJoinAndSelect('property.images', 'images')
      .where('property.code = :code', { code })
      .andWhere('property.publication_status IN (:...visible)', {
        visible: VISIBLE,
      })
      .orderBy('images.position', 'ASC')
      .getOne();

    if (!property)
      throw new NotFoundException(`Inmueble ${code} no encontrado`);

    return property;
  }

  /**
   * La tarjeta de contacto del asesor a cargo.
   *
   * No se resuelve con un `leftJoinAndSelect` a proposito: la relacion traeria
   * la fila entera —rol, estado, ultimo acceso— a una respuesta sin token. Se
   * pide aparte y se recorta a los cinco campos que un visitante necesita para
   * llamar. Si el asesor ya no esta activo no se enseña a nadie, y la ficha cae
   * en el contacto de la agencia.
   */
  private async publicAgent(
    agentId: string | null,
  ): Promise<PublicAgent | null> {
    if (!agentId) return null;

    const agent = await this.agents.findOne({
      where: { id: agentId, status: AgentStatus.ACTIVE },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        cellPhone: true,
        hasWhatsapp: true,
        photoUrl: true,
      },
    });
    if (!agent) return null;

    return {
      fullName: agent.fullName,
      email: agent.email,
      cellPhone: agent.cellPhone,
      hasWhatsapp: agent.hasWhatsapp,
      photoUrl: agent.photoUrl,
    };
  }

  /** Otras unidades del mismo proyecto: mismo sitio, otra medida. */
  siblingsOf(propertyId: string) {
    return this.familiesService.siblingsOf(propertyId, { publicOnly: true });
  }

  // --- proyectos ---------------------------------------------------------

  async listFamilies(
    dto: SearchPublicProjectsDto = {},
  ): Promise<Paginated<PublicFamily>> {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 12, 48);

    const qb = this.families
      .createQueryBuilder('family')
      .leftJoinAndSelect('family.city', 'city')
      .leftJoinAndSelect('family.zone', 'zone')
      .where('family.published = true')
      .andWhere('family.parent_id IS NULL');

    if (dto.q?.trim()) {
      qb.andWhere('LOWER(family.name) LIKE :q', {
        q: `%${dto.q.trim().toLowerCase()}%`,
      });
    }
    if (dto.cityId)
      qb.andWhere('family.city_id = :cityId', { cityId: dto.cityId });

    const [families, total] = await qb
      .orderBy('family.name', 'ASC')
      .addOrderBy('family.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Cada proyecto viaja con su recuento de unidades disponibles y su rango
    // de precio: sin eso, el listado es una lista de nombres. Solo se calcula
    // para la pagina que se devuelve, no para el catalogo entero.
    const data = await Promise.all(
      families.map(async (family) => {
        const unitTypes = await this.familiesService.unitTypes(family.id, {
          publicOnly: true,
        });
        const prices = unitTypes
          .map((u) => u.minPrice)
          .filter((p): p is number => p !== null);
        return {
          ...family,
          unitTypeCount: unitTypes.length,
          availableUnits: unitTypes.reduce((sum, u) => sum + u.available, 0),
          fromPrice: prices.length ? Math.min(...prices) : null,
        };
      }),
    );

    return new Paginated(data, total, page, limit);
  }

  async familyBySlug(slug: string) {
    const family = await this.familiesService.findBySlug(slug);
    if (!family.published)
      throw new NotFoundException(`Proyecto "${slug}" no encontrado`);

    const [unitTypes, properties] = await Promise.all([
      this.familiesService.unitTypes(family.id, { publicOnly: true }),
      this.familiesService.propertiesOf(family.id, { publicOnly: true }),
    ]);

    return {
      family,
      unitTypes,
      properties,
      amenities: await this.amenidades(properties.map((p) => p.id)),
    };
  }

  /**
   * Las zonas comunes del proyecto, sacadas de sus propias unidades.
   *
   * No hay una tabla de amenidades del conjunto ni hace falta inventarla: cada
   * inmueble ya trae sus caracteristicas EXTERNAS —piscina, salon comunal,
   * vigilancia—, y lo externo de un apartamento es, por definicion, lo que
   * comparte con los demas.
   *
   * Se piden solo las que estan en al menos la mitad de las unidades. Una que
   * aparece en una sola ficha no es una zona comun: es un dato mal cargado, y
   * enseñarla como si fuera del conjunto seria prometer algo que no existe.
   */
  private async amenidades(
    propertyIds: string[],
  ): Promise<{ id: number; name: string }[]> {
    if (!propertyIds.length) return [];

    const filas = await this.dataSource
      .createQueryBuilder()
      .select('feature.id', 'id')
      .addSelect('feature.name', 'name')
      .addSelect('COUNT(*)', 'count')
      .from('property_feature', 'pf')
      .innerJoin('feature', 'feature', 'feature.id = pf.feature_id')
      .where('pf.property_id IN (:...ids)', { ids: propertyIds })
      .andWhere("feature.scope = 'EXTERNAL'")
      .groupBy('feature.id')
      .addGroupBy('feature.name')
      .orderBy('COUNT(*)', 'DESC')
      .addOrderBy('feature.name', 'ASC')
      .getRawMany<{ id: number; name: string; count: string }>();

    const minimo = Math.ceil(propertyIds.length / 2);
    return filas
      .filter((f) => Number(f.count) >= minimo)
      .map((f) => ({ id: f.id, name: f.name }));
  }

  // --- agenda ------------------------------------------------------------

  /** Días con hueco para visitar un inmueble. */
  async availabilityFor(
    code: string,
    from: string,
    to: string,
  ): Promise<DayAvailability[]> {
    const property = await this.properties.findOne({
      where: { code },
      loadEagerRelations: false,
      select: {
        id: true,
        assignedAgentId: true,
        availability: true,
        forSale: true,
        forRent: true,
      },
    });
    if (!property)
      throw new NotFoundException(`Inmueble ${code} no encontrado`);

    // La antelacion depende del inmueble, no es una constante del sitio: uno
    // reservado o retirado necesita margen para hablar con el propietario
    // antes de enseñarlo; uno disponible se puede ver mañana. Lo decide la
    // agencia desde el panel.
    const minLeadHours = await this.bookingSettings.leadHoursFor(property);

    return this.availability.calendar(from, to, {
      minLeadHours,
      propertyAgentId: property.assignedAgentId ?? undefined,
    });
  }

  /**
   * Mueve una visita ya pedida a otra hora.
   *
   * Se identifica por el id que se devolvio al agendarla: lo tiene quien la
   * pidio y nadie mas. No vale el telefono — cualquiera que se sepa un numero
   * podria mover la visita de otro.
   *
   * Existe porque sin esto el asistente, al pedirle "cambiame la cita", creaba
   * una SEGUNDA y decia que la habia cambiado. El asesor se plantaba dos veces.
   */
  async rescheduleVisit(
    appointmentId: string,
    startsAt: string,
  ): Promise<{
    appointmentId: string;
    startsAt: Date;
    endsAt: Date;
    message: string;
  }> {
    const appointment = await this.appointments.findOne({
      where: { id: appointmentId },
      loadEagerRelations: false,
    });
    if (!appointment) throw new NotFoundException('Esa visita no existe');
    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException(
        'Esa visita ya no se puede cambiar. Un asesor te ayuda con eso.',
      );
    }

    const inicio = new Date(startsAt);
    if (Number.isNaN(inicio.getTime()))
      throw new BadRequestException('Fecha invalida');

    const property = await this.properties.findOne({
      where: { id: appointment.propertyId ?? undefined },
      loadEagerRelations: false,
      select: { id: true, availability: true, forSale: true, forRent: true },
    });
    const leadHours = property
      ? await this.bookingSettings.leadHoursFor(property)
      : await this.bookingSettings.defaultLeadHours();
    const minStart = new Date(Date.now() + leadHours * 3600 * 1000);
    if (inicio < minStart) throw new BadRequestException(tooSoon(leadHours));

    // El asesor asignado tiene que seguir libre a la hora nueva; si no, no se
    // mueve nada y se le dice que elija otra.
    const fin = new Date(inicio.getTime() + 60 * 60 * 1000);
    const libre = await this.availability.isAgentFree(
      appointment.agentId,
      inicio,
      fin,
      appointment.id,
    );
    if (!libre) {
      throw new ConflictException(
        'Esa hora ya esta ocupada. Elige otra de las disponibles.',
      );
    }

    await this.appointments.update(
      { id: appointment.id },
      { startsAt: inicio, endsAt: fin },
    );

    await this.activities.record({
      type: ActivityType.NOTE,
      clientId: appointment.clientId,
      propertyId: appointment.propertyId,
      agentId: appointment.agentId,
      summary: 'Visita reprogramada desde la web',
      detail: `De ${appointment.startsAt.toISOString()} a ${inicio.toISOString()}`,
      automatic: true,
    });

    return {
      appointmentId: appointment.id,
      startsAt: inicio,
      endsAt: fin,
      message: 'Visita reprogramada. Un asesor te confirmara por telefono.',
    };
  }

  /**
   * Reserva una visita desde la web.
   *
   * Hace de una vez lo que antes eran tres pasos manuales: da de alta al
   * interesado como cliente, lo vincula al inmueble y crea la cita con el
   * asesor que tenga hueco y menos carga ese día.
   */
  async bookVisit(dto: BookVisitDto, ip?: string) {
    const property = await this.properties.findOne({
      where: { id: dto.propertyId },
      loadEagerRelations: false,
      select: {
        id: true,
        code: true,
        title: true,
        assignedAgentId: true,
        publicationStatus: true,
      },
    });
    if (!property || !VISIBLE.includes(property.publicationStatus)) {
      throw new NotFoundException('Inmueble no disponible');
    }

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()))
      throw new BadRequestException('Fecha invalida');

    // La misma antelacion con la que se ofrecieron las horas. Si aqui se usara
    // otra, la web enseñaria franjas que luego se rechazan.
    const leadHours = await this.bookingSettings.leadHoursFor(property);
    const minStart = new Date(Date.now() + leadHours * 3600 * 1000);
    if (startsAt < minStart) throw new BadRequestException(tooSoon(leadHours));

    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const agentId = await this.availability.pickAgentFor(
      startsAt,
      endsAt,
      property.assignedAgentId,
    );
    if (!agentId) {
      throw new ConflictException(
        'Esa franja acaba de ocuparse. Elige otra hora del calendario.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const phoneNormalized = normalizePhone(dto.phone);

      // Si ya existe por telefono no se duplica: la mayoria de los leads de
      // portales entran varias veces con el mismo movil.
      let client = phoneNormalized
        ? await manager.findOne(Client, {
            where: { phoneNormalized },
            loadEagerRelations: false,
          })
        : null;

      if (!client) {
        const { pipelineId, stageId } = await this.defaultPlacement();
        const webSource = await this.sources.findOne({
          where: { name: 'Página web' },
        });
        client = await manager.save(
          manager.create(Client, {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName?.trim() ?? null,
            cellPhone: dto.phone.trim(),
            phoneNormalized,
            email: dto.email?.trim().toLowerCase() ?? null,
            pipelineId,
            stageId,
            stageChangedAt: new Date(),
            sourceId: webSource?.id ?? null,
            assignedAgentId: agentId,
            requirement: dto.message?.trim() ?? null,
            lastContactedAt: new Date(),
            acceptsMarketing: false,
          }),
        );
      } else {
        await manager.update(
          Client,
          { id: client.id },
          { lastContactedAt: new Date() },
        );
      }

      const existingInterest = await manager.findOne(PropertyInterest, {
        where: {
          clientId: client.id,
          propertyId: property.id,
          role: InterestRole.PROSPECT,
        },
        loadEagerRelations: false,
      });
      if (!existingInterest) {
        await manager.save(
          manager.create(PropertyInterest, {
            clientId: client.id,
            propertyId: property.id,
            role: InterestRole.PROSPECT,
          }),
        );
      }

      const appointment = await manager.save(
        manager.create(Appointment, {
          title: `Visita ${property.code} — ${dto.firstName.trim()}`,
          type: AppointmentType.VISIT,
          status: AppointmentStatus.SCHEDULED,
          startsAt,
          endsAt,
          agentId,
          clientId: client.id,
          propertyId: property.id,
          notes: dto.message?.trim() ?? null,
        }),
      );

      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: client.id,
        propertyId: property.id,
        agentId,
        summary: `Visita pedida desde la web para ${property.code}`,
        detail: dto.message?.trim() ?? null,
        automatic: true,
      });

      return {
        appointmentId: appointment.id,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        propertyCode: property.code,
        message:
          'Visita agendada. Un asesor te confirmará por teléfono antes de la cita.',
        ip,
      };
    });
  }

  // --- consignaciones ----------------------------------------------------

  async createConsignment(
    dto: CreateConsignmentDto,
    ip?: string,
    /** Presente solo si la envio un propietario ya identificado en el portal. */
    clientId?: string,
  ): Promise<ConsignmentRequest> {
    const reference = await this.nextConsignmentReference();

    const request = this.consignments.create({
      reference,
      status: ConsignmentStatus.NEW,
      clientId: clientId ?? null,
      cityId: dto.cityId ?? null,
      cityName: dto.cityName.trim(),
      commune: dto.commune?.trim() ?? null,
      neighborhood: dto.neighborhood.trim(),
      complexName: dto.complexName.trim(),
      address: dto.address.trim(),
      unitNumber: dto.unitNumber.trim(),
      stratum: dto.stratum,
      propertyTypeId: dto.propertyTypeId ?? null,
      propertyTypeName: dto.propertyTypeName.trim(),
      floor: dto.floor?.trim() ?? null,
      view: dto.view ?? null,
      hasElevator: dto.hasElevator,
      condition: dto.condition,
      privateArea: dto.privateArea?.toString() ?? null,
      builtArea: dto.builtArea.toString(),
      lotArea: dto.lotArea?.toString() ?? null,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      parkingSpaces: dto.parkingSpaces,
      hasStorageRoom: dto.hasStorageRoom,
      buildingYear: dto.buildingYear,
      amenityIds: dto.amenityIds ?? [],
      amenitiesOther: dto.amenitiesOther?.trim() ?? null,
      maintenanceFee: dto.maintenanceFee.toString(),
      salePrice: dto.salePrice.toString(),
      creditType: dto.creditType,
      creditInstitution: dto.creditInstitution?.trim() ?? null,
      debtAmount: dto.debtAmount?.toString() ?? null,
      occupancy: dto.occupancy,
      rentAmount: dto.rentAmount?.toString() ?? null,
      leaseEndsOn: dto.leaseEndsOn ?? null,
      ownerFirstName: dto.ownerFirstName.trim(),
      ownerLastName: dto.ownerLastName.trim(),
      ownerEmail: dto.ownerEmail.trim().toLowerCase(),
      ownerPhone: dto.ownerPhone.trim(),
      notes: dto.notes?.trim() ?? null,
      files: [],
      requestedVisitAt: dto.requestedVisitAt
        ? new Date(dto.requestedVisitAt)
        : null,
      submittedFromIp: ip?.slice(0, 64) ?? null,
    });

    return this.consignments.save(request);
  }

  async consignmentByReference(reference: string): Promise<ConsignmentRequest> {
    const request = await this.consignments.findOne({ where: { reference } });
    if (!request)
      throw new NotFoundException(`Solicitud ${reference} no encontrada`);
    return request;
  }

  /** Adjunta documentos y fotos a una solicitud ya creada. */
  async attachFiles(id: string, files: ConsignmentFile[]): Promise<void> {
    const request = await this.consignments.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    request.files = [...request.files, ...files];
    await this.consignments.save(request);
  }

  /** Disponibilidad del equipo sin atarla a un inmueble concreto. */
  async teamAvailability(from: string, to: string) {
    return this.availability.calendar(from, to, {
      minLeadHours: await this.bookingSettings.defaultLeadHours(),
    });
  }

  private async defaultPlacement(): Promise<{
    pipelineId: string;
    stageId: string;
  }> {
    const pipeline = await this.pipelines.findDefault();
    const first = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    if (!first)
      throw new BadRequestException(
        `El embudo "${pipeline.name}" no tiene etapas`,
      );
    return { pipelineId: pipeline.id, stageId: first.id };
  }

  /** Referencia correlativa legible: el propietario la usa para preguntar. */
  private async nextConsignmentReference(): Promise<string> {
    const row = await this.consignments
      .createQueryBuilder('request')
      .select(
        "MAX(NULLIF(regexp_replace(request.reference, '\\D', '', 'g'), '')::int)",
        'max',
      )
      .getRawOne<{ max: number | null }>();
    return `SC-${String((row?.max ?? 0) + 1).padStart(6, '0')}`;
  }
}

/** El mismo aviso en todos los sitios, dicho como lo diria una persona. */
function tooSoon(leadHours: number): string {
  if (leadHours <= 24) return 'Las visitas se piden con un dia de antelacion.';
  const dias = Math.round(leadHours / 24);
  return `Las visitas de este inmueble se piden con ${dias} dias de antelacion.`;
}
