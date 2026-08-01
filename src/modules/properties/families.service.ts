import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, TreeRepository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Property } from './domain/property.entity';
import { PropertyFamily } from './domain/property-family.entity';
import { Availability, PublicationStatus } from './domain/property.enums';
import type {
  CreateFamilyDto,
  SearchFamiliesDto,
  UpdateFamilyDto,
} from './dto/family.dto';

/** Tipología: una forma de unidad dentro del proyecto, con su rango. */
export interface UnitTypeSummary {
  unitType: string | null;
  propertyType: string;
  units: number;
  available: number;
  minArea: number | null;
  maxArea: number | null;
  bedrooms: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

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

    return qb.orderBy('family.name', 'ASC').getMany();
  }

  async findById(id: string): Promise<PropertyFamily> {
    const family = await this.repo.findOne({
      where: { id },
      relations: { children: true },
    });
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

  /** Árbol completo, para el selector jerárquico del formulario. */
  async trees(): Promise<PropertyFamily[]> {
    return this.tree.findTrees();
  }

  /**
   * Inmuebles del proyecto, incluidos los de sus etapas.
   *
   * `publicOnly` es lo que separa la web pública del panel: fuera solo se
   * muestran los que están publicados y disponibles.
   */
  async propertiesOf(
    id: string,
    { publicOnly = false } = {},
  ): Promise<Property[]> {
    const family = await this.findById(id);
    const ids = (await this.tree.findDescendants(family)).map((f) => f.id);

    const qb = this.properties
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.propertyType', 'propertyType')
      .leftJoinAndSelect('property.city', 'city')
      .leftJoinAndSelect('property.zone', 'zone')
      .leftJoinAndSelect('property.currency', 'currency')
      .leftJoinAndSelect('property.images', 'images', 'images.is_main = true')
      .where('property.family_id IN (:...ids)', {
        ids: ids.length ? ids : [family.id],
      });

    if (publicOnly) {
      qb.andWhere('property.publication_status IN (:...visible)', {
        visible: [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING],
      }).andWhere('property.availability = :available', {
        available: Availability.AVAILABLE,
      });
    }

    return qb
      .orderBy('property.area', 'ASC')
      .addOrderBy('property.sale_price', 'ASC')
      .getMany();
  }

  /**
   * Tipologías disponibles: agrupa las unidades del proyecto por forma y tipo,
   * con su rango de área y precio.
   *
   * Es lo que se enseña en la ficha de un proyecto — nadie quiere ver veinte
   * apartamentos casi iguales, quiere ver "Tipo A, 3 alcobas, 78–84 m², desde
   * $320 M" y elegir.
   */
  async unitTypes(
    id: string,
    { publicOnly = false } = {},
  ): Promise<UnitTypeSummary[]> {
    const family = await this.findById(id);
    const ids = (await this.tree.findDescendants(family)).map((f) => f.id);

    const qb = this.properties
      .createQueryBuilder('property')
      .innerJoin('property.propertyType', 'propertyType')
      .select('property.unit_type', 'unitType')
      .addSelect('propertyType.name', 'propertyType')
      .addSelect('property.bedrooms', 'bedrooms')
      .addSelect('COUNT(*)::int', 'units')
      .addSelect(
        `COUNT(*) FILTER (WHERE property.availability = '${Availability.AVAILABLE}')::int`,
        'available',
      )
      .addSelect('MIN(property.area)', 'minArea')
      .addSelect('MAX(property.area)', 'maxArea')
      .addSelect('MIN(NULLIF(property.sale_price, 0))', 'minPrice')
      .addSelect('MAX(NULLIF(property.sale_price, 0))', 'maxPrice')
      .where('property.family_id IN (:...ids)', {
        ids: ids.length ? ids : [family.id],
      })
      .groupBy('property.unit_type')
      .addGroupBy('propertyType.name')
      .addGroupBy('property.bedrooms')
      .orderBy('"minArea"', 'ASC');

    if (publicOnly) {
      qb.andWhere('property.publication_status IN (:...visible)', {
        visible: [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING],
      });
    }

    const rows = await qb.getRawMany<Record<string, string | number | null>>();
    return rows.map((row) => ({
      unitType: (row.unitType as string) ?? null,
      propertyType: String(row.propertyType),
      units: Number(row.units),
      available: Number(row.available),
      minArea: num(row.minArea),
      maxArea: num(row.maxArea),
      bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
      minPrice: num(row.minPrice),
      maxPrice: num(row.maxPrice),
    }));
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

  /** Asigna o desvincula un inmueble de un proyecto. */
  async assignProperty(
    propertyId: string,
    familyId: string | null,
    unitType?: string | null,
  ): Promise<void> {
    if (familyId) await this.findById(familyId);
    const exists = await this.properties.exists({ where: { id: propertyId } });
    if (!exists)
      throw new NotFoundException(`Inmueble ${propertyId} no encontrado`);

    await this.properties.update(
      { id: propertyId },
      { familyId, unitType: unitType?.trim() || null },
    );
  }

  /** Inmuebles sin proyecto, para el flujo de alta masiva. */
  async unassigned(limit = 50): Promise<Property[]> {
    return this.properties.find({
      where: { familyId: IsNull() },
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async count(): Promise<number> {
    return this.repo.count();
  }
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
