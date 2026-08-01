import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Paginated } from '../../shared/http/paginated';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { Client } from '../crm/domain/client.entity';
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
import { AvailabilityService } from '../scheduling/availability.service';
import {
  ConsignmentRequest,
  ConsignmentStatus,
  type ConsignmentFile,
} from './domain/consignment-request.entity';
import type { BookVisitDto, CreateConsignmentDto } from './dto/consignment.dto';
import type { SearchPublicPropertiesDto } from './dto/public-search.dto';

/** Solo se enseña fuera lo publicado; el resto ni existe para la web. */
const VISIBLE = [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING];

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
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
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

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

    if (dto.q?.trim()) {
      qb.andWhere('property.search_text LIKE :q', {
        q: `%${dto.q.trim().toLowerCase()}%`,
      });
    }
    if (dto.cityId)
      qb.andWhere('property.city_id = :cityId', { cityId: dto.cityId });
    if (dto.zoneId)
      qb.andWhere('property.zone_id = :zoneId', { zoneId: dto.zoneId });
    if (dto.propertyTypeId) {
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
    if (dto.minArea)
      qb.andWhere('property.area >= :minArea', { minArea: dto.minArea });
    if (dto.maxArea)
      qb.andWhere('property.area <= :maxArea', { maxArea: dto.maxArea });
    if (dto.forRent === 'true') qb.andWhere('property.for_rent = true');
    if (dto.forSale === 'true') qb.andWhere('property.for_sale = true');

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

  /** Ficha pública por código. El uuid no se expone fuera. */
  async propertyByCode(code: string): Promise<Property> {
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

    // Una visita a la ficha pública es la señal de interés más barata que hay.
    await this.properties.increment({ id: property.id }, 'visits', 1);
    return property;
  }

  /** Otras unidades del mismo proyecto: mismo sitio, otra medida. */
  siblingsOf(propertyId: string) {
    return this.familiesService.siblingsOf(propertyId, { publicOnly: true });
  }

  // --- proyectos ---------------------------------------------------------

  async listFamilies(cityId?: number) {
    const qb = this.families
      .createQueryBuilder('family')
      .leftJoinAndSelect('family.city', 'city')
      .leftJoinAndSelect('family.zone', 'zone')
      .where('family.published = true')
      .andWhere('family.parent_id IS NULL');

    if (cityId) qb.andWhere('family.city_id = :cityId', { cityId });

    const families = await qb.orderBy('family.name', 'ASC').getMany();

    // Cada proyecto viaja con su recuento de unidades disponibles y su rango
    // de precio: sin eso, el listado es una lista de nombres.
    return Promise.all(
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
  }

  async familyBySlug(slug: string) {
    const family = await this.familiesService.findBySlug(slug);
    if (!family.published)
      throw new NotFoundException(`Proyecto "${slug}" no encontrado`);

    const [unitTypes, properties] = await Promise.all([
      this.familiesService.unitTypes(family.id, { publicOnly: true }),
      this.familiesService.propertiesOf(family.id, { publicOnly: true }),
    ]);

    return { family, unitTypes, properties };
  }

  // --- agenda ------------------------------------------------------------

  /** Días con hueco para visitar un inmueble. */
  async availabilityFor(code: string, from: string, to: string) {
    const property = await this.properties.findOne({
      where: { code },
      loadEagerRelations: false,
      select: { id: true, assignedAgentId: true },
    });
    if (!property)
      throw new NotFoundException(`Inmueble ${code} no encontrado`);

    return this.availability.calendar(from, to, {
      minLeadHours: this.config.publicBookingLeadHours,
      propertyAgentId: property.assignedAgentId ?? undefined,
    });
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

    const minStart = new Date(
      Date.now() + this.config.publicBookingLeadHours * 3600 * 1000,
    );
    if (startsAt < minStart) {
      throw new BadRequestException(
        `Las visitas se piden con al menos ${this.config.publicBookingLeadHours} horas de antelacion`,
      );
    }

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
  ): Promise<ConsignmentRequest> {
    const reference = await this.nextConsignmentReference();

    const request = this.consignments.create({
      reference,
      status: ConsignmentStatus.NEW,
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
  teamAvailability(from: string, to: string) {
    return this.availability.calendar(from, to, {
      minLeadHours: this.config.publicBookingLeadHours,
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
