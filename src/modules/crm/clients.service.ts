import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Paginated } from '../../shared/http/paginated';
import { ClientType } from '../catalog/domain/catalogs.entity';
import { AgentsService } from '../iam/agents/agents.service';
import {
  applyOwnershipScope,
  assertCanMutate,
  resolveOwner,
} from '../iam/scope';
import { PropertiesService } from '../properties/properties.service';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { Client } from './domain/client.entity';
import { LeadSource } from './domain/lead-source.entity';
import { PropertyInterest } from './domain/property-interest.entity';
import { PipelinesService } from './pipelines.service';
import type {
  CreateClientDto,
  LinkPropertyDto,
  MoveStageDto,
  ReassignClientDto,
  SearchClientsDto,
  UpdateClientDto,
} from './dto/client.dto';

/** Deja solo digitos y descarta el prefijo de pais colombiano. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const local =
    digits.startsWith('57') && digits.length > 10 ? digits.slice(2) : digits;
  return local.slice(-10);
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private readonly repo: Repository<Client>,
    @InjectRepository(PropertyInterest)
    private readonly interests: Repository<PropertyInterest>,
    @InjectRepository(LeadSource)
    private readonly sources: Repository<LeadSource>,
    @InjectRepository(ClientType)
    private readonly types: Repository<ClientType>,
    private readonly pipelines: PipelinesService,
    private readonly agents: AgentsService,
    private readonly properties: PropertiesService,
    private readonly dataSource: DataSource,
  ) {}

  // --- lectura -----------------------------------------------------------

  async search(
    dto: SearchClientsDto,
    actor: AuthenticatedActor,
  ): Promise<Paginated<Client>> {
    const qb = this.repo
      .createQueryBuilder('client')
      .leftJoinAndSelect('client.pipeline', 'pipeline')
      .leftJoinAndSelect('client.stage', 'stage')
      .leftJoinAndSelect('client.source', 'source')
      .leftJoinAndSelect('client.city', 'city')
      .leftJoinAndSelect('client.assignedAgent', 'assignedAgent')
      .leftJoinAndSelect('client.types', 'types');

    if (dto.q?.trim()) {
      qb.andWhere('client.search_text LIKE :q', {
        q: `%${dto.q.trim().toLowerCase()}%`,
      });
    }
    if (dto.pipelineId)
      qb.andWhere('client.pipeline_id = :pipelineId', {
        pipelineId: dto.pipelineId,
      });
    if (dto.stageId?.length)
      qb.andWhere('client.stage_id IN (:...stageIds)', {
        stageIds: dto.stageId,
      });
    if (dto.sourceId)
      qb.andWhere('client.source_id = :sourceId', { sourceId: dto.sourceId });
    if (dto.assignedAgentId) {
      qb.andWhere('client.assigned_agent_id = :agentId', {
        agentId: dto.assignedAgentId,
      });
    }
    if (dto.cityId)
      qb.andWhere('client.city_id = :cityId', { cityId: dto.cityId });

    if (dto.typeId?.length) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM client_client_type cct
                  WHERE cct.client_id = client.id AND cct.client_type_id IN (:...typeIds))`,
        { typeIds: dto.typeId },
      );
    }

    if (dto.staleSince) {
      // Sin contacto desde la fecha, incluyendo a los que nunca se contactaron.
      qb.andWhere(
        '(client.last_contacted_at IS NULL OR client.last_contacted_at < :staleSince)',
        {
          staleSince: dto.staleSince,
        },
      );
    }

    if (dto.openOnly === 'true') {
      qb.andWhere('stage.is_won = false AND stage.is_lost = false');
    }

    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');

    qb.orderBy('client.updated_at', 'DESC').addOrderBy('client.id', 'DESC');

    const [data, total] = await qb
      .skip(dto.skip)
      .take(dto.limit)
      .getManyAndCount();
    return new Paginated(data, total, dto.page, dto.limit);
  }

  async findOne(id: string, actor: AuthenticatedActor): Promise<Client> {
    const qb = this.repo
      .createQueryBuilder('client')
      .leftJoinAndSelect('client.pipeline', 'pipeline')
      .leftJoinAndSelect('client.stage', 'stage')
      .leftJoinAndSelect('client.source', 'source')
      .leftJoinAndSelect('client.city', 'city')
      .leftJoinAndSelect('client.assignedAgent', 'assignedAgent')
      .leftJoinAndSelect('client.types', 'types')
      .where('client.id = :id', { id });
    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');

    const client = await qb.getOne();
    if (!client) throw new NotFoundException(`Cliente ${id} no encontrado`);
    return client;
  }

  async exists(id: string): Promise<boolean> {
    return this.repo.exists({ where: { id } });
  }

  // --- escritura ---------------------------------------------------------

  async create(
    dto: CreateClientDto,
    actor: AuthenticatedActor,
  ): Promise<Client> {
    const { pipelineId, stageId } = await this.resolvePlacement(
      dto.pipelineId,
      dto.stageId,
    );
    const assignedAgentId = resolveOwner(actor, dto.assignedAgentId);
    await this.agents.findById(assignedAgentId);

    const { typeIds, ...rest } = dto;
    const client = this.repo.create({
      ...rest,
      pipelineId,
      stageId,
      stageChangedAt: new Date(),
      assignedAgentId,
      phoneNormalized: normalizePhone(dto.cellPhone ?? dto.phone),
      types: typeIds?.length
        ? await this.types.findBy({ id: In(typeIds) })
        : [],
    });
    return this.repo.save(client);
  }

  async update(
    id: string,
    dto: UpdateClientDto,
    actor: AuthenticatedActor,
  ): Promise<Client> {
    // Sin `loadEagerRelations: false`, los objetos `city`, `source`, `stage`…
    // cargados pisarian las claves foraneas al guardar.
    const client = await this.repo.findOne({
      where: { id },
      relations: { types: true },
      loadEagerRelations: false,
    });
    if (!client) throw new NotFoundException(`Cliente ${id} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');

    const { typeIds, stageId, pipelineId, assignedAgentId, ...rest } = dto;
    Object.assign(client, rest);

    if (typeIds) {
      client.types = typeIds.length
        ? await this.types.findBy({ id: In(typeIds) })
        : [];
    }
    if (dto.cellPhone !== undefined || dto.phone !== undefined) {
      client.phoneNormalized = normalizePhone(client.cellPhone ?? client.phone);
    }
    if (stageId || pipelineId) {
      throw new BadRequestException(
        'Usa POST /clients/:id/stage para mover al cliente de etapa',
      );
    }
    if (assignedAgentId) {
      throw new BadRequestException(
        'Usa POST /clients/:id/reassign para cambiar de asesor',
      );
    }

    await this.repo.save(client);
    return this.findOne(id, actor);
  }

  async remove(id: string, actor: AuthenticatedActor): Promise<void> {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Cliente ${id} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');
    await this.repo.softDelete(id);
  }

  /**
   * Mueve al cliente de etapa. Devuelve tambien la etapa anterior para que la
   * bitacora pueda registrar el salto sin volver a consultar.
   */
  async moveStage(
    id: string,
    dto: MoveStageDto,
    actor: AuthenticatedActor,
  ): Promise<{ client: Client; from: string; to: string }> {
    const client = await this.repo.findOne({
      where: { id },
      relations: { stage: true },
    });
    if (!client) throw new NotFoundException(`Cliente ${id} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');

    const stage = await this.pipelines.findStage(dto.stageId);
    if (stage.id === client.stageId) {
      throw new BadRequestException('El cliente ya esta en esa etapa');
    }

    const from = client.stage?.name ?? '—';
    const now = new Date();

    // Se actualiza por columnas y no con `save`: la entidad trae cargada la
    // relacion `stage` anterior, y al persistirla TypeORM da prioridad al
    // objeto de la relacion sobre la clave foranea — el cambio se perderia.
    // Mover de etapa puede implicar cambiar de embudo; se mantienen coherentes.
    await this.repo.update(
      { id },
      {
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        stageChangedAt: now,
        lastContactedAt: now,
      },
    );

    return { client: await this.findOne(id, actor), from, to: stage.name };
  }

  async reassign(
    id: string,
    dto: ReassignClientDto,
    actor: AuthenticatedActor,
  ): Promise<Client> {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Cliente ${id} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');
    await this.agents.findById(dto.agentId);

    await this.repo.update({ id }, { assignedAgentId: dto.agentId });
    return this.findOne(id, actor);
  }

  async touchContact(id: string): Promise<void> {
    await this.repo.update({ id }, { lastContactedAt: new Date() });
  }

  // --- inmuebles de interes ----------------------------------------------

  async listInterests(clientId: string): Promise<PropertyInterest[]> {
    if (!(await this.exists(clientId))) {
      throw new NotFoundException(`Cliente ${clientId} no encontrado`);
    }
    return this.interests.find({
      where: { clientId },
      order: { createdAt: 'DESC' },
    });
  }

  async listInterestedClients(propertyId: string): Promise<PropertyInterest[]> {
    if (!(await this.properties.exists(propertyId))) {
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);
    }
    return this.interests.find({
      where: { propertyId },
      relations: { client: true },
      order: { createdAt: 'DESC' },
    });
  }

  async linkProperty(
    clientId: string,
    dto: LinkPropertyDto,
    actor: AuthenticatedActor,
  ): Promise<PropertyInterest> {
    const client = await this.repo.findOne({ where: { id: clientId } });
    if (!client)
      throw new NotFoundException(`Cliente ${clientId} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');

    if (!(await this.properties.exists(dto.propertyId))) {
      throw new NotFoundException(`Inmueble ${dto.propertyId} no encontrado`);
    }

    const role = dto.role ?? 'PROSPECT';
    const existing = await this.interests.findOne({
      where: {
        clientId,
        propertyId: dto.propertyId,
        role: role as PropertyInterest['role'],
      },
    });

    const interest =
      existing ??
      this.interests.create({
        clientId,
        propertyId: dto.propertyId,
        role: role as PropertyInterest['role'],
      });
    if (dto.status) interest.status = dto.status;
    if (dto.notes !== undefined) interest.notes = dto.notes ?? null;
    if (dto.offeredAmount !== undefined)
      interest.offeredAmount = String(dto.offeredAmount);

    const saved = await this.interests.save(interest);
    await this.touchContact(clientId);
    return saved;
  }

  async unlinkProperty(
    clientId: string,
    interestId: string,
    actor: AuthenticatedActor,
  ): Promise<void> {
    const client = await this.repo.findOne({ where: { id: clientId } });
    if (!client)
      throw new NotFoundException(`Cliente ${clientId} no encontrado`);
    assertCanMutate(actor, client.assignedAgentId, 'este cliente');

    const interest = await this.interests.findOne({
      where: { id: interestId, clientId },
    });
    if (!interest)
      throw new NotFoundException('Ese interes no pertenece al cliente');
    await this.interests.delete(interestId);
  }

  // --- duplicados --------------------------------------------------------

  /**
   * Agrupa clientes que comparten telefono o correo. En el volcado hay 554
   * moviles y 9 correos repetidos: son el mismo lead entrando por varios
   * portales, y hoy se trabajan por duplicado.
   */
  async findDuplicates(
    limit = 50,
  ): Promise<{ key: string; kind: 'phone' | 'email'; clients: Client[] }[]> {
    const byPhone = await this.repo
      .createQueryBuilder('client')
      .select('client.phone_normalized', 'key')
      .addSelect('COUNT(*)::int', 'count')
      .where('client.phone_normalized IS NOT NULL')
      .andWhere('LENGTH(client.phone_normalized) >= 7')
      .groupBy('client.phone_normalized')
      .having('COUNT(*) > 1')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany<{ key: string; count: number }>();

    const byEmail = await this.repo
      .createQueryBuilder('client')
      .select('LOWER(client.email)', 'key')
      .addSelect('COUNT(*)::int', 'count')
      .where("client.email IS NOT NULL AND client.email <> ''")
      .groupBy('LOWER(client.email)')
      .having('COUNT(*) > 1')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany<{ key: string; count: number }>();

    const groups: {
      key: string;
      kind: 'phone' | 'email';
      clients: Client[];
    }[] = [];

    for (const row of byPhone) {
      groups.push({
        key: row.key,
        kind: 'phone',
        clients: await this.repo.find({
          where: { phoneNormalized: row.key },
          order: { createdAt: 'ASC' },
        }),
      });
    }
    for (const row of byEmail) {
      groups.push({
        key: row.key,
        kind: 'email',
        clients: await this.repo
          .createQueryBuilder('client')
          .where('LOWER(client.email) = :email', { email: row.key })
          .orderBy('client.created_at', 'ASC')
          .getMany(),
      });
    }
    return groups;
  }

  /**
   * Fusiona duplicados sobre un cliente principal: mueve los intereses, rellena
   * los huecos de datos y archiva los sobrantes. No borra informacion.
   */
  async merge(
    primaryId: string,
    duplicateIds: string[],
    actor: AuthenticatedActor,
  ): Promise<Client> {
    const primary = await this.repo.findOne({
      where: { id: primaryId },
      loadEagerRelations: false,
    });
    if (!primary)
      throw new NotFoundException(`Cliente ${primaryId} no encontrado`);
    assertCanMutate(actor, primary.assignedAgentId, 'este cliente');

    const ids = duplicateIds.filter((id) => id !== primaryId);
    if (!ids.length)
      throw new BadRequestException('No hay duplicados que fusionar');

    return this.dataSource.transaction(async (manager) => {
      const duplicates = await manager.find(Client, {
        where: { id: In(ids) },
        loadEagerRelations: false,
      });
      if (duplicates.length !== ids.length) {
        throw new NotFoundException('Alguno de los duplicados no existe');
      }

      for (const dup of duplicates) {
        primary.email ??= dup.email;
        primary.cellPhone ??= dup.cellPhone;
        primary.phone ??= dup.phone;
        primary.identification ??= dup.identification;
        primary.birthday ??= dup.birthday;
        primary.cityId ??= dup.cityId;
        primary.sourceId ??= dup.sourceId;
        primary.requirement = joinNotes(primary.requirement, dup.requirement);
        primary.notes = joinNotes(primary.notes, dup.notes);

        // Los intereses ya presentes en el principal se descartan; el resto se
        // reapunta. El indice unico (cliente, inmueble, rol) impide colisiones.
        const dupInterests = await manager.find(PropertyInterest, {
          where: { clientId: dup.id },
        });
        for (const interest of dupInterests) {
          const clash = await manager.findOne(PropertyInterest, {
            where: {
              clientId: primaryId,
              propertyId: interest.propertyId,
              role: interest.role,
            },
          });
          if (clash) await manager.delete(PropertyInterest, interest.id);
          else
            await manager.update(PropertyInterest, interest.id, {
              clientId: primaryId,
            });
        }
      }

      primary.phoneNormalized = normalizePhone(
        primary.cellPhone ?? primary.phone,
      );
      const saved = await manager.save(primary);
      await manager.softDelete(Client, ids);
      return saved;
    });
  }

  // --- fuentes -----------------------------------------------------------

  listSources(): Promise<LeadSource[]> {
    return this.sources.find({ order: { name: 'ASC' } });
  }

  private async resolvePlacement(
    pipelineId?: string,
    stageId?: string,
  ): Promise<{ pipelineId: string; stageId: string }> {
    if (stageId) {
      const stage = await this.pipelines.findStage(stageId);
      if (pipelineId && stage.pipelineId !== pipelineId) {
        throw new BadRequestException(
          'La etapa no pertenece al embudo indicado',
        );
      }
      return { pipelineId: stage.pipelineId, stageId: stage.id };
    }

    const pipeline = pipelineId
      ? await this.pipelines.findById(pipelineId)
      : await this.pipelines.findDefault();
    const first = [...pipeline.stages].sort(
      (a, b) => a.position - b.position,
    )[0];
    if (!first)
      throw new BadRequestException(
        `El embudo "${pipeline.name}" no tiene etapas`,
      );
    return { pipelineId: pipeline.id, stageId: first.id };
  }
}

function joinNotes(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  return `${a}\n---\n${b}`;
}
