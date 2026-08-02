import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Paginated } from '../../shared/http/paginated';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { CatalogService } from '../catalog/catalog.service';
import { Client } from '../crm/domain/client.entity';
import {
  InterestRole,
  PropertyInterest,
} from '../crm/domain/property-interest.entity';
import { PipelinesService } from '../crm/pipelines.service';
import { normalizePhone } from '../crm/clients.service';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import {
  Availability,
  PropertyCondition,
  PublicationStatus,
} from '../properties/domain/property.enums';
import { Feature } from '../catalog/domain/catalogs.entity';
import {
  ConsignmentCondition,
  ConsignmentRequest,
  ConsignmentStatus,
} from './domain/consignment-request.entity';
import type {
  ReviewConsignmentDto,
  SearchConsignmentsDto,
} from './dto/consignment.dto';

/** El estado del inmueble en el formulario se traduce al del inventario. */
const CONDITION_MAP: Record<ConsignmentCondition, PropertyCondition> = {
  [ConsignmentCondition.ORIGINAL]: PropertyCondition.USED,
  [ConsignmentCondition.TO_REMODEL]: PropertyCondition.USED,
  [ConsignmentCondition.REMODELED]: PropertyCondition.USED,
  [ConsignmentCondition.BRAND_NEW]: PropertyCondition.NEW,
  [ConsignmentCondition.SHELL]: PropertyCondition.UNDER_CONSTRUCTION,
  [ConsignmentCondition.BLUEPRINT]: PropertyCondition.PROJECT,
};

/**
 * Bandeja de solicitudes de consignacion.
 *
 * La parte que aporta valor no es listarlas sino `accept`: convierte una
 * solicitud en un inmueble del inventario y en un cliente propietario, con sus
 * fotos ya subidas, sin que nadie vuelva a teclear los treinta campos del
 * formulario.
 */
@Injectable()
export class ConsignmentsService {
  constructor(
    @InjectRepository(ConsignmentRequest)
    private readonly repo: Repository<ConsignmentRequest>,
    @InjectRepository(Feature) private readonly features: Repository<Feature>,
    private readonly catalog: CatalogService,
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
    private readonly dataSource: DataSource,
  ) {}

  async search(
    dto: SearchConsignmentsDto,
  ): Promise<Paginated<ConsignmentRequest>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;

    const qb = this.repo.createQueryBuilder('request');
    if (dto.status)
      qb.andWhere('request.status = :status', { status: dto.status });
    if (dto.q?.trim()) {
      const q = `%${dto.q.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(request.owner_first_name) LIKE :q OR LOWER(request.owner_last_name) LIKE :q
          OR LOWER(request.owner_email) LIKE :q OR request.owner_phone LIKE :q
          OR LOWER(request.address) LIKE :q OR LOWER(request.complex_name) LIKE :q
          OR LOWER(request.reference) LIKE :q)`,
        { q },
      );
    }

    const [data, total] = await qb
      // Las nuevas primero: una consignacion sin revisar es dinero esperando.
      .orderBy(
        `CASE WHEN request.status = '${ConsignmentStatus.NEW}' THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('request.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return new Paginated(data, total, page, limit);
  }

  async findById(id: string): Promise<ConsignmentRequest> {
    const request = await this.repo.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada`);
    return request;
  }

  async counts(): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('request')
      .select('request.status', 'status')
      .addSelect('COUNT(*)::int', 'total')
      .groupBy('request.status')
      .getRawMany<{ status: string; total: number }>();
    return Object.fromEntries(rows.map((row) => [row.status, row.total]));
  }

  async review(
    id: string,
    dto: ReviewConsignmentDto,
    actor: AuthenticatedActor,
  ): Promise<ConsignmentRequest> {
    const request = await this.findById(id);
    if (request.status === ConsignmentStatus.ACCEPTED) {
      throw new BadRequestException('La solicitud ya se convirtio en inmueble');
    }

    request.status = dto.status;
    request.resolution = dto.resolution?.trim() ?? request.resolution;
    request.reviewedByAgentId = actor.id;
    request.reviewedAt = new Date();
    return this.repo.save(request);
  }

  /**
   * Convierte la solicitud en inventario: crea el inmueble, da de alta al
   * propietario como cliente y los vincula. Las fotos que envio el propietario
   * pasan a ser las del inmueble.
   */
  async accept(
    id: string,
    actor: AuthenticatedActor,
  ): Promise<{ propertyId: string; clientId: string }> {
    const request = await this.findById(id);
    if (request.propertyId) {
      throw new BadRequestException(
        `Esta solicitud ya se convirtio en el inmueble ${request.propertyId}`,
      );
    }

    // La ciudad y el tipo son obligatorios en el inventario, pero en el
    // formulario publico son texto libre: si no se resolvieron, hay que
    // completarlos antes de aceptar.
    if (!request.cityId || !request.propertyTypeId) {
      throw new BadRequestException(
        'Antes de aceptarla asigna la ciudad y el tipo de inmueble del catalogo',
      );
    }
    await this.catalog.assertReferences({
      cityId: request.cityId,
      propertyTypeId: request.propertyTypeId,
    });

    const pipeline = await this.pipelines.findDefault();
    const stage = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    if (!stage)
      throw new BadRequestException(
        `El embudo "${pipeline.name}" no tiene etapas`,
      );

    const amenities = request.amenityIds.length
      ? await this.features.findBy(
          request.amenityIds.map((featureId) => ({ id: featureId })),
        )
      : [];

    return this.dataSource.transaction(async (manager) => {
      const code = await nextCode(manager);

      const property = await manager.save(
        manager.create(Property, {
          code,
          title:
            `${request.propertyTypeName.toUpperCase()} EN VENTA EN ${request.complexName.toUpperCase()} ` +
            `${request.neighborhood.toUpperCase()} ${request.cityName.toUpperCase()}`.slice(
              0,
              300,
            ),
          address: `${request.address} ${request.unitNumber}`
            .trim()
            .slice(0, 300),
          forSale: true,
          forRent: Boolean(
            request.rentAmount && Number(request.rentAmount) > 0,
          ),
          salePrice: Number(request.salePrice),
          rentPrice: request.rentAmount ? Number(request.rentAmount) : null,
          maintenanceFee: Number(request.maintenanceFee) || null,
          currencyId: 1,
          propertyTypeId: request.propertyTypeId as number,
          cityId: request.cityId as number,
          area: Number(request.builtArea),
          builtArea: Number(request.builtArea),
          privateArea: request.privateArea ? Number(request.privateArea) : null,
          bedrooms: request.bedrooms,
          bathrooms: request.bathrooms,
          garages: request.parkingSpaces,
          floor: toInt(request.floor),
          stratum: request.stratum,
          condition: CONDITION_MAP[request.condition],
          buildingYear: request.buildingYear,
          observations: request.notes,
          availability: Availability.AVAILABLE,
          // Nace como borrador: el asesor revisa fotos y texto antes de que
          // salga a los portales.
          publicationStatus: PublicationStatus.DRAFT,
          assignedAgentId: actor.id,
          features: amenities,
        }),
      );

      // Las fotos que subio el propietario ya estan procesadas en `uploads/`:
      // basta con colgarlas del inmueble.
      const photos = request.files.filter((file) => file.kind === 'PHOTO');
      if (photos.length) {
        await manager.save(
          photos.map((photo, index) =>
            manager.create(PropertyImage, {
              propertyId: property.id,
              storageKey: photo.storageKey,
              url: photo.url,
              urlMedium: photo.url.replace(/-t\.webp$/, '-m.webp'),
              urlLarge: photo.url.replace(/-t\.webp$/, '-l.webp'),
              urlOriginal: photo.url.replace(/-t\.webp$/, '-o.webp'),
              sourceUrl: null,
              description: null,
              position: index + 1,
              isMain: index === 0,
              bytes: photo.bytes,
            }),
          ),
        );
      }

      const phoneNormalized = normalizePhone(request.ownerPhone);
      let client = phoneNormalized
        ? await manager.findOne(Client, {
            where: { phoneNormalized },
            loadEagerRelations: false,
          })
        : null;

      if (!client) {
        client = await manager.save(
          manager.create(Client, {
            firstName: request.ownerFirstName,
            lastName: request.ownerLastName,
            email: request.ownerEmail,
            cellPhone: request.ownerPhone,
            phoneNormalized,
            pipelineId: pipeline.id,
            stageId: stage.id,
            stageChangedAt: new Date(),
            assignedAgentId: actor.id,
            requirement: `Consigna ${request.complexName} — ${request.address}`,
            lastContactedAt: new Date(),
          }),
        );
      }

      await manager.save(
        manager.create(PropertyInterest, {
          clientId: client.id,
          propertyId: property.id,
          role: InterestRole.OWNER,
        }),
      );

      await manager.update(
        ConsignmentRequest,
        { id },
        {
          status: ConsignmentStatus.ACCEPTED,
          propertyId: property.id,
          clientId: client.id,
          reviewedByAgentId: actor.id,
          reviewedAt: new Date(),
        },
      );

      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: client.id,
        propertyId: property.id,
        agentId: actor.id,
        summary: `Consignación ${request.reference} aceptada`,
        detail: `Alta desde la solicitud web de ${request.ownerFirstName} ${request.ownerLastName}`,
        automatic: true,
      });

      return { propertyId: property.id, clientId: client.id };
    });
  }
}

function toInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mismo esquema de codigo que el alta manual, para no partir la secuencia. */
async function nextCode(manager: {
  query: (sql: string) => Promise<{ max: string | null }[]>;
}) {
  const [row] = await manager.query(
    `SELECT MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::bigint) AS max FROM property`,
  );
  return String((row?.max ? Number(row.max) : 100000) + 1);
}
