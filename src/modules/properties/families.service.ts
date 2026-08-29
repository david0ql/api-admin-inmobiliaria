import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, TreeRepository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import {
  applyBranchScope,
  assertSameBranch,
  resolveBranch,
} from '../iam/scope';
import { RequestContext } from '../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { Property } from './domain/property.entity';
import { PropertyFamily } from './domain/property-family.entity';
import { Availability, PublicationStatus } from './domain/property.enums';
import type {
  CreateFamilyDto,
  SearchFamiliesDto,
  UpdateFamilyDto,
} from './dto/family.dto';

@Injectable()
export class FamiliesService {
  constructor(
    @InjectRepository(PropertyFamily)
    private readonly repo: Repository<PropertyFamily>,
    @InjectRepository(PropertyFamily)
    private readonly tree: TreeRepository<PropertyFamily>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly catalog: CatalogService,
  ) {}

  // --- lectura -----------------------------------------------------------

  async search(dto: SearchFamiliesDto): Promise<PropertyFamily[]> {
    const qb = this.repo
      .createQueryBuilder('family')
      .leftJoinAndSelect('family.city', 'city')
      .leftJoinAndSelect('family.zone', 'zone');

    if (dto.q?.trim()) {
      qb.andWhere('LOWER(family.name) LIKE :q', {
        q: `%${dto.q.trim().toLowerCase()}%`,
      });
    }
    if (dto.cityId)
      qb.andWhere('family.city_id = :cityId', { cityId: dto.cityId });
    if (dto.kind) qb.andWhere('family.kind = :kind', { kind: dto.kind });
    if (dto.status)
      qb.andWhere('family.status = :status', { status: dto.status });
    if (dto.publishedOnly === 'true') qb.andWhere('family.published = true');
    if (dto.rootsOnly === 'true') qb.andWhere('family.parent_id IS NULL');
    applyBranchScope(qb, 'family.branch_id');

    return qb.orderBy('family.name', 'ASC').getMany();
  }

  /**
   * El proyecto, si la sede en curso lo alcanza.
   *
   * Va por QueryBuilder para poder acotar por sede: desde la web publica no hay
   * sede en el contexto y no filtra nada, que es lo que debe pasar ahi.
   */
  async findById(id: string): Promise<PropertyFamily> {
    const qb = this.repo
      .createQueryBuilder('family')
      .leftJoinAndSelect('family.children', 'children')
      .where('family.id = :id', { id });
    applyBranchScope(qb, 'family.branch_id');

    const family = await qb.getOne();
    if (!family) throw new NotFoundException(`Proyecto ${id} no encontrado`);
    return family;
  }

  async findBySlug(slug: string): Promise<PropertyFamily> {
    const family = await this.repo.findOne({
      where: { slug },
      relations: { children: true },
    });
    if (!family)
      throw new NotFoundException(`Proyecto "${slug}" no encontrado`);
    return family;
  }

  /**
   * Arbol completo, para el selector jerarquico del formulario.
   *
   * `findTrees` no admite condiciones, asi que la sede se poda despues sobre el
   * resultado. Es la unica consulta que se filtra en memoria y se puede: no
   * pagina ni cuenta nada —es un desplegable—, que es lo que hacia peligroso
   * filtrar fuera de SQL en los listados.
   */
  async trees(): Promise<PropertyFamily[]> {
    const arboles = await this.tree.findTrees();
    const branchId = RequestContext.branchId();
    if (!branchId) return arboles;
    return podar(arboles, branchId);
  }

  /**
   * Inmuebles del proyecto, incluidos los de sus etapas.
   *
   * `publicOnly` es lo que separa la web pública del panel: fuera solo se
   * muestran los que están publicados y disponibles.
   */
  async propertiesOf(
    id: string,
    { publicOnly = false, allImages = false } = {},
  ): Promise<Property[]> {
    const ids = await this.descendantIds(id);

    const qb = this.properties
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.unitType', 'unitType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      /*
        La portada basta para una tarjeta, pero la pagina del proyecto enseña
        las fotos de la unidad que se elige: ahi hacen falta todas.
      */
      .leftJoinAndSelect(
        'property.images',
        'images',
        allImages ? undefined : 'images.is_main = true',
      )
      .where('property.family_id IN (:...ids)', { ids });

    // La web publica ensena el proyecto entero; el panel, solo lo de su sede.
    if (!publicOnly) applyBranchScope(qb, 'property.branch_id');

    if (publicOnly) {
      qb.andWhere('property.publication_status IN (:...visible)', {
        visible: [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING],
      }).andWhere('property.availability = :available', {
        available: Availability.AVAILABLE,
      });
    }

    return (
      qb
        .orderBy('property.area', 'ASC')
        .addOrderBy('property.sale_price', 'ASC')
        // La principal primero: es la que se enseña al abrir la unidad.
        .addOrderBy('images.is_main', 'DESC')
        .getMany()
    );
  }

  /**
   * El proyecto y sus etapas, como lista de ids.
   *
   * Todo lo que se pregunta de un proyecto —sus inmuebles, sus tipologías— se
   * pregunta tambien de sus torres: `findById` acota por sede antes, de modo
   * que un proyecto de otra oficina no llega a devolver ids.
   */
  async descendantIds(id: string): Promise<string[]> {
    const family = await this.findById(id);
    const ids = (await this.tree.findDescendants(family)).map((f) => f.id);
    return ids.length ? ids : [family.id];
  }

  /**
   * Los "hermanos" de un inmueble: otras unidades del mismo proyecto.
   * Es lo que se enseña al final de la ficha — mismo sitio, otra medida.
   */
  async siblingsOf(
    propertyId: string,
    { publicOnly = false, limit = 12 } = {},
  ): Promise<Property[]> {
    const property = await this.properties.findOne({
      where: { id: propertyId },
      loadEagerRelations: false,
      select: { id: true, familyId: true },
    });
    if (!property?.familyId) return [];

    const all = await this.propertiesOf(property.familyId, { publicOnly });
    return all.filter((sibling) => sibling.id !== propertyId).slice(0, limit);
  }

  // --- escritura ---------------------------------------------------------

  async create(dto: CreateFamilyDto): Promise<PropertyFamily> {
    const branchId = resolveBranch(this.actor(), dto.branchId);
    const slug = dto.slug?.trim() || slugify(dto.name);
    if (
      await this.repo.findOne({ where: [{ name: dto.name.trim() }, { slug }] })
    ) {
      throw new ConflictException(
        `Ya existe un proyecto llamado "${dto.name}" o con ese slug`,
      );
    }
    await this.catalog.assertReferences({
      cityId: dto.cityId ?? undefined,
      zoneId: dto.zoneId ?? null,
    });

    const parent = dto.parentId ? await this.findById(dto.parentId) : null;

    return this.repo.save(
      this.repo.create({
        ...dto,
        branchId,
        name: dto.name.trim(),
        slug,
        parent,
        parentId: parent?.id ?? null,
        latitude: dto.latitude?.toString() ?? null,
        longitude: dto.longitude?.toString() ?? null,
      }),
    );
  }

  async update(id: string, dto: UpdateFamilyDto): Promise<PropertyFamily> {
    const family = await this.repo.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!family) throw new NotFoundException(`Proyecto ${id} no encontrado`);
    assertSameBranch(this.actor(), family.branchId);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          'Un proyecto no puede ser su propia etapa',
        );
      }
      const parent = await this.findById(dto.parentId);
      // Un ciclo en el arbol deja la tabla de closure inconsistente y cuelga
      // cualquier recorrido posterior.
      const descendants = await this.tree.findDescendants(family);
      if (descendants.some((d) => d.id === dto.parentId)) {
        throw new BadRequestException(
          'No puedes colgar el proyecto de una de sus propias etapas',
        );
      }
      family.parent = parent;
      family.parentId = parent.id;
    }

    // `parentId` ya se aplico arriba con validacion de ciclos.
    const { latitude, longitude, ...rest } = dto;
    delete (rest as { parentId?: string }).parentId;
    // Mover el proyecto de oficina es cosa de quien ve todas las sedes.
    if (dto.branchId && dto.branchId !== family.branchId) {
      family.branchId = resolveBranch(this.actor(), dto.branchId);
    }
    delete (rest as { branchId?: string }).branchId;
    Object.assign(family, rest);
    if (latitude !== undefined) family.latitude = latitude?.toString() ?? null;
    if (longitude !== undefined)
      family.longitude = longitude?.toString() ?? null;
    if (dto.name) family.name = dto.name.trim();

    await this.repo.save(family);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const family = await this.findById(id);
    assertSameBranch(this.actor(), family.branchId);
    const units = await this.properties.count({ where: { familyId: id } });
    if (units > 0) {
      throw new BadRequestException(
        `"${family.name}" tiene ${units} inmuebles asignados: muévelos antes de borrarlo`,
      );
    }
    const children = await this.repo.count({ where: { parentId: id } });
    if (children > 0) {
      throw new BadRequestException(
        `"${family.name}" tiene etapas: bórralas primero`,
      );
    }
    await this.repo.softDelete(id);
  }

  /**
   * Asigna o desvincula un inmueble de un proyecto.
   *
   * La tipología no se toca aquí, se pone luego con `PATCH /properties/:id`:
   * cambiar de proyecto la invalida siempre —el "Tipo A" es del edificio, no
   * del apartamento— asi que se limpia, y dejarla puesta seria enseñar en la
   * ficha el plano de otro conjunto.
   */
  async assignProperty(
    propertyId: string,
    familyId: string | null,
  ): Promise<void> {
    // `findById` ya acota por sede: colgar un inmueble de un proyecto de otra
    // oficina devuelve "no encontrado" y no un enlace cruzado.
    if (familyId) await this.findById(familyId);

    const property = await this.properties.findOne({
      where: { id: propertyId },
      loadEagerRelations: false,
      select: { id: true, branchId: true },
    });
    if (!property)
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);
    assertSameBranch(this.actor(), property.branchId);

    await this.properties.update(
      { id: propertyId },
      { familyId, unitTypeId: null },
    );
  }

  /** Inmuebles sin proyecto, para el flujo de alta masiva. */
  async unassigned(limit = 50): Promise<Property[]> {
    const qb = this.properties
      .createQueryBuilder('property')
      .where('property.family_id IS NULL');
    applyBranchScope(qb, 'property.branch_id');
    return qb.orderBy('property.created_at', 'DESC').take(limit).getMany();
  }

  async count(): Promise<number> {
    const qb = this.repo.createQueryBuilder('family');
    applyBranchScope(qb, 'family.branch_id');
    return qb.getCount();
  }

  /**
   * Quien esta pidiendo esto.
   *
   * El controlador de proyectos no arrastra el actor por la firma —nunca lo
   * necesito— y anadirlo a seis metodos para dos comprobaciones no compensa:
   * el contexto de peticion ya lo tiene, igual que lo tiene el filtro por sede.
   */
  private actor(): AuthenticatedActor {
    const actor = RequestContext.actor();
    if (!actor) {
      throw new ForbiddenException('Esta operacion requiere sesion');
    }
    return actor;
  }
}

/** Deja solo las ramas de una sede, conservando la jerarquia. */
function podar(familias: PropertyFamily[], branchId: string): PropertyFamily[] {
  return familias
    .filter((familia) => familia.branchId === branchId)
    .map((familia) => {
      familia.children = podar(familia.children ?? [], branchId);
      return familia;
    });
}

/** "Reserva de la Loma" -> "reserva-de-la-loma". */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 220);
}
