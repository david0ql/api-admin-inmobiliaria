import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Paginated } from '../../shared/http/paginated';
import { CatalogService } from '../catalog/catalog.service';
import { StorageService } from '../media/storage.service';
import { Feature } from '../catalog/domain/catalogs.entity';
import { AgentsService } from '../iam/agents/agents.service';
import {
  applyBranchScope,
  applyOwnershipScope,
  assertCanMutate,
  assertSameBranch,
  resolveBranch,
  resolveOwner,
} from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { Property } from './domain/property.entity';
import { PropertyImage } from './domain/property-image.entity';
import { PropertyLabel } from './domain/property-label.entity';
import {
  AssignmentRole,
  PropertyAssignment,
} from './domain/property-assignment.entity';
import { PublicationStatus } from './domain/property.enums';
import {
  AssignPropertyDto,
  CreatePropertyDto,
  ReorderImagesDto,
  UpdatePropertyDto,
} from './dto/property.dto';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import {
  applyPropertyFilters,
  applyPropertySort,
} from './features/search-properties';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property) private readonly repo: Repository<Property>,
    @InjectRepository(PropertyImage)
    private readonly images: Repository<PropertyImage>,
    @InjectRepository(PropertyLabel)
    private readonly labels: Repository<PropertyLabel>,
    @InjectRepository(PropertyAssignment)
    private readonly assignments: Repository<PropertyAssignment>,
    @InjectRepository(Feature) private readonly features: Repository<Feature>,
    private readonly catalog: CatalogService,
    private readonly agents: AgentsService,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  // --- lectura -----------------------------------------------------------

  async search(
    dto: SearchPropertiesDto,
    actor: AuthenticatedActor,
  ): Promise<Paginated<Property>> {
    const qb = this.repo
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.label', 'label')
      .leftJoinAndSelect('property.assignedAgent', 'assignedAgent')
      // `family` es eager en la entidad, pero el QueryBuilder ignora eso: sin
      // este join el inmueble sale siempre como suelto aunque tenga proyecto.
      .leftJoinAndSelect('property.family', 'family')
      // Solo la portada: traer las 6.340 imagenes en un listado seria absurdo.
      .leftJoinAndSelect(
        'property.images',
        'mainImage',
        'mainImage.is_main = true',
      );

    applyPropertyFilters(qb, dto);
    applyOwnershipScope(qb, actor, 'property.assigned_agent_id');
    // Los dos recortes son independientes y se suman: "de mi sede" y, dentro,
    // "los mios" si el rol no ve mas que lo suyo.
    applyBranchScope(qb, 'property.branch_id');
    applyPropertySort(qb, dto.sort);

    const [data, total] = await qb
      .skip(dto.skip)
      .take(dto.limit)
      .getManyAndCount();
    return new Paginated(data, total, dto.page, dto.limit);
  }

  async findOne(id: string, actor: AuthenticatedActor): Promise<Property> {
    const qb = this.repo
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('city.region', 'region')
      .leftJoinAndSelect('region.country', 'country')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.label', 'label')
      .leftJoinAndSelect('property.assignedAgent', 'assignedAgent')
      .leftJoinAndSelect('property.family', 'family')
      .leftJoinAndSelect('property.features', 'features')
      .leftJoinAndSelect('property.images', 'images')
      .where('property.id = :id', { id })
      .orderBy('images.position', 'ASC');

    applyOwnershipScope(qb, actor, 'property.assigned_agent_id');
    applyBranchScope(qb, 'property.branch_id');

    const property = await qb.getOne();
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    return property;
  }

  async findByCode(code: string): Promise<Property | null> {
    return this.repo.findOne({ where: { code }, relations: { images: true } });
  }

  /**
   * Existe Y es alcanzable desde la sede en curso.
   *
   * Lo usan publicaciones, citas e intereses antes de enlazar: si no mirara la
   * sede, un coordinador podria colgar una cita o una publicacion de un
   * inmueble de otra oficina con solo conocer su id.
   */
  async exists(id: string): Promise<boolean> {
    const qb = this.repo
      .createQueryBuilder('property')
      .where('property.id = :id', { id });
    applyBranchScope(qb, 'property.branch_id');
    return (await qb.getCount()) > 0;
  }

  /** Suma una visita. Se hace con UPDATE atomico para no perder concurrentes. */
  async registerVisit(id: string): Promise<void> {
    await this.repo.increment({ id }, 'visits', 1);
  }

  // --- escritura ---------------------------------------------------------

  async create(
    dto: CreatePropertyDto,
    actor: AuthenticatedActor,
  ): Promise<Property> {
    await this.catalog.assertReferences({
      propertyTypeId: dto.propertyTypeId,
      currencyId: dto.currencyId,
      cityId: dto.cityId,
      zoneId: dto.zoneId ?? null,
      featureIds: dto.featureIds,
    });

    const assignedAgentId = resolveOwner(actor, dto.assignedAgentId);
    const asesor = await this.agents.findById(assignedAgentId);
    const branchId = resolveBranch(actor, dto.branchId);
    // Un coordinador puede asignar a cualquiera de los suyos, pero no cargarle
    // un inmueble a un asesor de otra oficina.
    assertSameBranch(actor, asesor.branchId);

    const { featureIds, ...rest } = dto;
    const property = this.repo.create({
      ...rest,
      branchId,
      forSale: dto.forSale ?? true,
      forRent: dto.forRent ?? false,
      forTransfer: dto.forTransfer ?? false,
      forTemporaryRent: dto.forTemporaryRent ?? false,
      code: dto.code ?? (await this.nextCode()),
      assignedAgentId,
      publicationStatus: dto.publicationStatus ?? PublicationStatus.DRAFT,
      features: featureIds?.length
        ? await this.features.findBy({ id: In(featureIds) })
        : [],
    });

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(property);
      await manager.save(
        manager.create(PropertyAssignment, {
          propertyId: saved.id,
          agentId: assignedAgentId,
          role: AssignmentRole.CAPTURE,
          assignedByAgentId: actor.id,
        }),
      );
      return saved;
    });
  }

  async update(
    id: string,
    dto: UpdatePropertyDto,
    actor: AuthenticatedActor,
  ): Promise<Property> {
    // `loadEagerRelations: false` es imprescindible: si se cargan `city`,
    // `zone`, `label`… TypeORM da prioridad al objeto de la relacion sobre la
    // clave foranea al guardar, y los cambios de cityId o labelId se perderian.
    const property = await this.repo.findOne({
      where: { id },
      relations: { features: true },
      loadEagerRelations: false,
    });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');

    await this.catalog.assertReferences({
      propertyTypeId: dto.propertyTypeId,
      currencyId: dto.currencyId,
      cityId: dto.cityId ?? property.cityId,
      zoneId: dto.zoneId ?? null,
      featureIds: dto.featureIds,
    });

    const { featureIds, assignedAgentId, branchId, ...rest } = dto;
    Object.assign(property, rest);

    // Cambiar de sede es mover el inmueble de oficina, no editar un campo: solo
    // lo hace quien las ve todas, y hacia una sede que exista de verdad.
    if (branchId && branchId !== property.branchId) {
      property.branchId = resolveBranch(actor, branchId);
    }

    if (featureIds) {
      property.features = featureIds.length
        ? await this.features.findBy({ id: In(featureIds) })
        : [];
    }
    // La reasignacion tiene su propio endpoint porque debe dejar historico.
    if (assignedAgentId && assignedAgentId !== property.assignedAgentId) {
      throw new BadRequestException(
        'Usa PATCH /properties/:id/assign para reasignar el inmueble',
      );
    }

    await this.repo.save(property);
    return this.findOne(id, actor);
  }

  async remove(id: string, actor: AuthenticatedActor): Promise<void> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');
    // Borrado logico: la ficha sigue disponible para el historico comercial,
    // y por eso sus fotos tampoco se tocan.
    await this.repo.softDelete(id);
  }

  // --- asignacion --------------------------------------------------------

  async assign(
    id: string,
    dto: AssignPropertyDto,
    actor: AuthenticatedActor,
  ): Promise<PropertyAssignment> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');
    const destino = await this.agents.findById(dto.agentId);
    assertSameBranch(actor, destino.branchId);

    if (property.assignedAgentId === dto.agentId) {
      throw new BadRequestException(
        'El inmueble ya esta asignado a ese asesor',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      // `IsNull()` y no `undefined`: TypeORM rechaza los undefined en un where.
      await manager.update(
        PropertyAssignment,
        { propertyId: id, unassignedAt: IsNull() },
        { unassignedAt: now },
      );
      const assignment = await manager.save(
        manager.create(PropertyAssignment, {
          propertyId: id,
          agentId: dto.agentId,
          role: AssignmentRole.LISTING,
          assignedAt: now,
          reason: dto.reason ?? null,
          assignedByAgentId: actor.id,
        }),
      );
      await manager.update(Property, { id }, { assignedAgentId: dto.agentId });
      return assignment;
    });
  }

  async assignmentHistory(id: string): Promise<PropertyAssignment[]> {
    // El historial dice quien ha llevado el inmueble: es informacion del
    // equipo, y solo la ve la sede a la que pertenece.
    if (!(await this.exists(id))) {
      throw new NotFoundException(`Inmueble ${id} no encontrado`);
    }
    return this.assignments.find({
      where: { propertyId: id },
      order: { assignedAt: 'DESC' },
    });
  }

  // --- imagenes ----------------------------------------------------------

  /**
   * Sube fotos al almacenamiento propio.
   *
   * Recibe los binarios en memoria; `StorageService` valida que sean imagenes
   * de verdad, genera las variantes y devuelve las rutas ya servibles. Las
   * fotos que fallen se reportan sin tumbar el resto del lote.
   */
  async addImages(
    id: string,
    files: Express.Multer.File[],
    actor: AuthenticatedActor,
  ): Promise<{
    images: PropertyImage[];
    rejected: { name: string; reason: string }[];
  }> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');

    if (!files?.length) {
      throw new BadRequestException(
        'No llego ningun archivo en el campo `files`',
      );
    }

    const existing = await this.images.count({ where: { propertyId: id } });
    const saved: PropertyImage[] = [];
    const rejected: { name: string; reason: string }[] = [];

    for (const file of files) {
      try {
        const stored = await this.storage.saveImage(
          file.buffer,
          `properties/${id}`,
          file.originalname,
        );
        saved.push(
          await this.images.save(
            this.images.create({
              propertyId: id,
              storageKey: stored.key,
              url: stored.url,
              urlMedium: stored.urlMedium,
              urlLarge: stored.urlLarge,
              urlOriginal: stored.urlOriginal,
              checksum: stored.checksum,
              width: stored.width,
              height: stored.height,
              bytes: stored.bytes,
              description: null,
              position: existing + saved.length + 1,
              // La primera foto del inmueble se convierte en portada.
              isMain: existing === 0 && saved.length === 0,
            }),
          ),
        );
      } catch (error) {
        rejected.push({
          name: file.originalname,
          reason:
            error instanceof Error
              ? error.message
              : 'Error al procesar la imagen',
        });
      }
    }

    if (!saved.length) {
      throw new BadRequestException(
        `Ninguna imagen se pudo guardar. ${rejected.map((r) => `${r.name}: ${r.reason}`).join('; ')}`,
      );
    }

    return { images: saved, rejected };
  }

  async reorderImages(
    id: string,
    dto: ReorderImagesDto,
    actor: AuthenticatedActor,
  ): Promise<PropertyImage[]> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');

    const images = await this.images.find({ where: { propertyId: id } });
    const known = new Set(images.map((i) => i.id));
    if (
      dto.imageIds.length !== images.length ||
      dto.imageIds.some((i) => !known.has(i))
    ) {
      throw new BadRequestException(
        'El orden debe incluir exactamente las imagenes actuales del inmueble',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      for (const [index, imageId] of dto.imageIds.entries()) {
        await manager.update(
          PropertyImage,
          { id: imageId },
          { position: index + 1 },
        );
      }
    });
    return this.images.find({
      where: { propertyId: id },
      order: { position: 'ASC' },
    });
  }

  async setMainImage(
    id: string,
    imageId: string,
    actor: AuthenticatedActor,
  ): Promise<void> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');

    const image = await this.images.findOne({
      where: { id: imageId, propertyId: id },
    });
    if (!image)
      throw new NotFoundException('La imagen no pertenece a este inmueble');

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        PropertyImage,
        { propertyId: id },
        { isMain: false },
      );
      await manager.update(PropertyImage, { id: imageId }, { isMain: true });
    });
  }

  async removeImage(
    id: string,
    imageId: string,
    actor: AuthenticatedActor,
  ): Promise<void> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException(`Inmueble ${id} no encontrado`);
    assertSameBranch(actor, property.branchId);
    assertCanMutate(actor, property.assignedAgentId, 'este inmueble');

    const image = await this.images.findOne({
      where: { id: imageId, propertyId: id },
    });
    if (!image)
      throw new NotFoundException('La imagen no pertenece a este inmueble');

    await this.images.delete(imageId);
    // El registro y el fichero se van juntos: sin esto `uploads/` crece con
    // huerfanos que nadie vuelve a mirar.
    await this.storage.remove(image.storageKey);

    if (image.isMain) {
      // Sin portada la ficha se ve rota: se promueve la siguiente por posicion.
      const next = await this.images.findOne({
        where: { propertyId: id },
        order: { position: 'ASC' },
      });
      if (next) await this.images.update({ id: next.id }, { isMain: true });
    }
  }

  // --- etiquetas ---------------------------------------------------------

  listLabels(): Promise<PropertyLabel[]> {
    return this.labels.find({ order: { name: 'ASC' } });
  }

  async createLabel(name: string, color: string): Promise<PropertyLabel> {
    return this.labels.save(this.labels.create({ name, color }));
  }

  /**
   * Codigo secuencial legible. Arranca por encima del maximo existente para
   * convivir con los codigos heredados de WASI sin colisionar.
   */
  private async nextCode(): Promise<string> {
    const row = await this.repo
      .createQueryBuilder('property')
      .select(
        "MAX(NULLIF(regexp_replace(property.code, '\\D', '', 'g'), '')::bigint)",
        'max',
      )
      .getRawOne<{ max: string | null }>();
    return String((row?.max ? Number(row.max) : 100000) + 1);
  }
}
