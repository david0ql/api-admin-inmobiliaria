import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { Paginated } from '../../shared/http/paginated';
import { RequestContext } from '../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { assertSameBranch, resolveBranch } from '../iam/scope';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { Client } from '../crm/domain/client.entity';
import { LeadSource } from '../crm/domain/lead-source.entity';
import {
  InterestRole,
  PropertyInterest,
} from '../crm/domain/property-interest.entity';
import { PipelinesService } from '../crm/pipelines.service';
import { normalizePhone } from '../crm/clients.service';
import { Property } from '../properties/domain/property.entity';
import {
  CreditRequest,
  CreditRequestStatus,
  HousingType,
  PortfolioType,
  type CoApplicant,
} from './domain/credit-request.entity';
import type {
  CreateCreditRequestDto,
  ReviewCreditRequestDto,
  SearchCreditRequestsDto,
} from './dto/credit.dto';

/**
 * Consultas de viabilidad de credito.
 *
 * La creacion es publica y la bandeja es interna, igual que en consignaciones.
 * Lo que aporta valor es `convert`: da de alta al interesado como cliente en el
 * embudo con el caso ya escrito en el requerimiento — monto, plazo, ocupacion y
 * el inmueble si lo hay — para que el asesor llame sabiendo de que se trata.
 */
@Injectable()
export class CreditRequestsService {
  constructor(
    @InjectRepository(CreditRequest)
    private readonly repo: Repository<CreditRequest>,
    @InjectRepository(LeadSource)
    private readonly sources: Repository<LeadSource>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly pipelines: PipelinesService,
    private readonly activities: ActivitiesService,
    private readonly dataSource: DataSource,
  ) {}

  // --- entrada publica ---------------------------------------------------

  async create(
    dto: CreateCreditRequestDto,
    ip?: string,
  ): Promise<CreditRequest> {
    // El inmueble es opcional, pero si viene un codigo se resuelve ahora: mas
    // tarde el asesor solo tendria el texto que escribio un desconocido.
    const property = dto.propertyCode
      ? await this.properties.findOne({
          where: { code: dto.propertyCode.trim() },
          loadEagerRelations: false,
          select: { id: true, code: true },
        })
      : null;

    const coApplicant: CoApplicant | null = dto.coApplicant
      ? {
          firstName: dto.coApplicant.firstName.trim(),
          lastName: dto.coApplicant.lastName.trim(),
          birthDate: dto.coApplicant.birthDate,
          phone: dto.coApplicant.phone.trim(),
          email: dto.coApplicant.email.trim().toLowerCase(),
          documentType: dto.coApplicant.documentType,
          documentNumber: dto.coApplicant.documentNumber.trim(),
          gender: dto.coApplicant.gender ?? null,
          occupation: dto.coApplicant.occupation,
          monthlyIncome: dto.coApplicant.monthlyIncome?.toString() ?? null,
        }
      : null;

    const request = this.repo.create({
      reference: await this.nextReference(),
      status: CreditRequestStatus.NEW,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      birthDate: dto.birthDate,
      phone: dto.phone.trim(),
      email: dto.email.trim().toLowerCase(),
      documentType: dto.documentType,
      documentNumber: dto.documentNumber.trim(),
      gender: dto.gender ?? null,
      occupation: dto.occupation,
      monthlyIncome: dto.monthlyIncome?.toString() ?? null,
      portfolioType: dto.portfolioType,
      housingType: dto.housingType,
      product: dto.product,
      termYears: dto.termYears,
      workCityId: dto.workCityId ?? null,
      workCityName: dto.workCityName.trim(),
      amount: dto.amount.toString(),
      hasPropertyPicked: dto.hasPropertyPicked,
      propertyValue: dto.propertyValue?.toString() ?? null,
      propertyCode: property?.code ?? dto.propertyCode?.trim() ?? null,
      propertyId: property?.id ?? null,
      coApplicant,
      notes: dto.notes?.trim() ?? null,
      acceptedTermsAt: new Date(),
      submittedFromIp: ip ?? null,
    });

    return this.repo.save(request);
  }

  async findByReference(reference: string): Promise<CreditRequest> {
    const request = await this.repo.findOne({ where: { reference } });
    if (!request)
      throw new NotFoundException(`Consulta ${reference} no encontrada`);
    return request;
  }

  // --- bandeja interna ---------------------------------------------------

  async search(
    dto: SearchCreditRequestsDto,
  ): Promise<Paginated<CreditRequest>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;

    const qb = this.repo.createQueryBuilder('request');
    this.acotarBandeja(qb);
    if (dto.status)
      qb.andWhere('request.status = :status', { status: dto.status });
    if (dto.q?.trim()) {
      const q = `%${dto.q.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(request.first_name) LIKE :q OR LOWER(request.last_name) LIKE :q
          OR LOWER(request.email) LIKE :q OR request.phone LIKE :q
          OR request.document_number LIKE :q OR LOWER(request.reference) LIKE :q)`,
        { q },
      );
    }

    const [data, total] = await qb
      // Una consulta de credito sin contestar caduca sola: el interesado
      // pregunta en otro sitio. Las nuevas van primero.
      .orderBy(
        `CASE WHEN request.status = '${CreditRequestStatus.NEW}' THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('request.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return new Paginated(data, total, page, limit);
  }

  async findById(id: string): Promise<CreditRequest> {
    const qb = this.repo
      .createQueryBuilder('request')
      .where('request.id = :id', { id });
    this.acotarBandeja(qb);

    const request = await qb.getOne();
    if (!request) throw new NotFoundException(`Consulta ${id} no encontrada`);
    return request;
  }

  async counts(): Promise<Record<string, number>> {
    const qb = this.repo
      .createQueryBuilder('request')
      .select('request.status', 'status')
      .addSelect('COUNT(*)::int', 'total')
      .groupBy('request.status');
    this.acotarBandeja(qb);

    const rows = await qb.getRawMany<{ status: string; total: number }>();
    return Object.fromEntries(rows.map((row) => [row.status, row.total]));
  }

  /**
   * La bandeja de una sede: lo suyo mas lo que aun no es de nadie.
   *
   * Igual que en consignaciones: la consulta entra por la web sin sesion y por
   * tanto sin sede. Dejarlas fuera de todas las bandejas seria condenarlas a no
   * contestarse.
   */
  private acotarBandeja(qb: SelectQueryBuilder<CreditRequest>): void {
    const branchId = RequestContext.branchId();
    if (!branchId) return;
    qb.andWhere(
      '(request.branch_id = :sedeBandeja OR request.branch_id IS NULL)',
      { sedeBandeja: branchId },
    );
  }

  async review(
    id: string,
    dto: ReviewCreditRequestDto,
    actor: AuthenticatedActor,
  ): Promise<CreditRequest> {
    const request = await this.findById(id);
    assertSameBranch(actor, request.branchId);

    request.status = dto.status;
    request.institution = dto.institution?.trim() ?? request.institution;
    request.resolution = dto.resolution?.trim() ?? request.resolution;
    request.reviewedByAgentId = actor.id;
    request.reviewedAt = new Date();
    // Quien la atiende se la lleva a su sede; ver la nota de consignaciones.
    request.branchId ??= RequestContext.branchId() ?? actor.branchId ?? null;
    return this.repo.save(request);
  }

  /**
   * Pasa la consulta al embudo: crea el cliente (o reutiliza el que ya tenga
   * ese movil), lo vincula al inmueble si lo habia y deja escrito el caso.
   */
  async convert(
    id: string,
    actor: AuthenticatedActor,
  ): Promise<{ clientId: string }> {
    const request = await this.findById(id);
    assertSameBranch(actor, request.branchId);
    // El cliente que se crea tiene sede obligatoria: la de quien convierte.
    const branchId = resolveBranch(actor, request.branchId);
    if (request.clientId) {
      throw new BadRequestException(
        `Esta consulta ya esta en el embudo como cliente ${request.clientId}`,
      );
    }

    const pipeline = await this.pipelines.findDefault();
    const stage = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    if (!stage)
      throw new BadRequestException(
        `El embudo "${pipeline.name}" no tiene etapas`,
      );

    const source = await this.sources.findOne({
      where: { name: 'Página web' },
    });

    return this.dataSource.transaction(async (manager) => {
      const phoneNormalized = normalizePhone(request.phone);
      // Se busca dentro de la sede: reutilizar la ficha de otra oficina le
      // quitaria el cliente a quien lo trabaja.
      let client = phoneNormalized
        ? await manager.findOne(Client, {
            where: { phoneNormalized, branchId },
            loadEagerRelations: false,
          })
        : null;

      if (!client) {
        client = await manager.save(
          manager.create(Client, {
            branchId,
            firstName: request.firstName,
            lastName: request.lastName,
            email: request.email,
            cellPhone: request.phone,
            phoneNormalized,
            pipelineId: pipeline.id,
            stageId: stage.id,
            stageChangedAt: new Date(),
            sourceId: source?.id ?? null,
            assignedAgentId: actor.id,
            requirement: describe(request),
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

      if (request.propertyId) {
        const existing = await manager.findOne(PropertyInterest, {
          where: {
            clientId: client.id,
            propertyId: request.propertyId,
            role: InterestRole.PROSPECT,
          },
          loadEagerRelations: false,
        });
        if (!existing) {
          await manager.save(
            manager.create(PropertyInterest, {
              clientId: client.id,
              propertyId: request.propertyId,
              role: InterestRole.PROSPECT,
            }),
          );
        }
      }

      await manager.update(
        CreditRequest,
        { id },
        {
          status: CreditRequestStatus.REVIEWING,
          branchId,
          clientId: client.id,
          assignedAgentId: actor.id,
          reviewedByAgentId: actor.id,
          reviewedAt: new Date(),
        },
      );

      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: client.id,
        propertyId: request.propertyId ?? undefined,
        agentId: actor.id,
        summary: `Consulta de crédito ${request.reference}`,
        detail: describe(request),
        automatic: true,
      });

      return { clientId: client.id };
    });
  }

  private async nextReference(): Promise<string> {
    const row = await this.repo
      .createQueryBuilder('request')
      .select(
        "MAX(NULLIF(regexp_replace(request.reference, '\\D', '', 'g'), '')::int)",
        'max',
      )
      .getRawOne<{ max: number | null }>();
    return `CR-${String((row?.max ?? 0) + 1).padStart(6, '0')}`;
  }
}

const OCCUPATION: Record<string, string> = {
  SALARIED: 'asalariado',
  PENSIONER: 'pensionado',
  SELF_EMPLOYED: 'independiente',
};

/** El caso en una linea, que es lo que el asesor lee antes de marcar. */
function describe(request: CreditRequest): string {
  const money = (value: string) =>
    `$${Number(value).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

  const parts = [
    `Crédito ${money(request.amount)} a ${request.termYears} años`,
    `${request.portfolioType === PortfolioType.VIS ? 'VIS' : 'No VIS'}, vivienda ${
      request.housingType === HousingType.NEW ? 'nueva' : 'usada'
    }`,
    OCCUPATION[request.occupation] ?? request.occupation.toLowerCase(),
  ];

  if (request.propertyCode) parts.push(`inmueble ${request.propertyCode}`);
  else if (request.propertyValue)
    parts.push(`inmueble de ${money(request.propertyValue)}`);
  else parts.push('todavía sin inmueble elegido');

  if (request.coApplicant)
    parts.push(
      `con segundo solicitante (${request.coApplicant.firstName} ${request.coApplicant.lastName})`,
    );

  return parts.join(' · ');
}
