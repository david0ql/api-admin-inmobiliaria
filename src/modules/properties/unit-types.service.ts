import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { applyBranchScope, assertSameBranch } from '../iam/scope';
import { RequestContext } from '../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { FamiliesService } from './families.service';
import { Property } from './domain/property.entity';
import { PropertyImage } from './domain/property-image.entity';
import { UnitType, UnitTypeKind } from './domain/unit-type.entity';
import { Availability, PublicationStatus } from './domain/property.enums';
import type {
  CreateUnitTypeDto,
  ReorderUnitTypesDto,
  UpdateUnitTypeDto,
} from './dto/unit-type.dto';

/**
 * Una tipología con lo que se sabe de sus unidades.
 *
 * Lo escrito por la agencia —nombre, alcobas, rango de área— y lo que sale de
 * contar los inmuebles que la tienen —cuántos hay, cuántos quedan, desde qué
 * precio— viajan juntos porque es lo que se pinta en la misma tarjeta.
 */
export interface UnitTypeSummary {
  /** Nulo en la fila de las unidades que aún no tienen tipología asignada. */
  id: string | null;
  code: string | null;
  name: string;
  description: string | null;
  kind: UnitTypeKind | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  builtArea: number | null;
  minArea: number | null;
  maxArea: number | null;
  units: number;
  available: number;
  minPrice: number | null;
  maxPrice: number | null;
  position: number;
  /** La unidad que la representa: la mas barata, la del "desde". */
  propertyId: string | null;
  /** Portada de esa unidad: sin foto, la tarjeta es un rectángulo. */
  coverUrl: string | null;
}

/** Lo que la agrupación por tipología saca de los inmuebles. */
interface Agregado {
  units: number;
  available: number;
  minArea: number | null;
  maxArea: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  bedrooms: number | null;
  propertyType: string | null;
  propertyId: string | null;
  coverUrl: string | null;
}

@Injectable()
export class UnitTypesService {
  constructor(
    @InjectRepository(UnitType)
    private readonly repo: Repository<UnitType>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly families: FamiliesService,
  ) {}

  // --- lectura -----------------------------------------------------------

  /**
   * Tipologías del proyecto —y de sus etapas— con sus agregados.
   *
   * Son dos consultas y no una a propósito: la lista sale de `unit_type`, que
   * es donde vive la decisión de la agencia, y los números salen de agrupar los
   * inmuebles. Con un solo LEFT JOIN, el filtro por sede —que va en el WHERE—
   * se llevaría por delante las tipologías sin unidades en esa oficina, y una
   * tipología recién creada desaparecería del panel justo mientras se le
   * asignan unidades.
   *
   * `publicOnly` es lo que separa la web del panel: fuera solo cuentan las
   * unidades publicadas, y una tipología sin ninguna no se enseña. Dentro se
   * enseña todo, incluidas las vacías, que es lo que hay que poder editar.
   */
  async summaries(
    id: string,
    { publicOnly = false } = {},
  ): Promise<UnitTypeSummary[]> {
    const ids = await this.families.descendantIds(id);

    const tipologias = await this.repo
      .createQueryBuilder('unitType')
      .where('unitType.family_id IN (:...ids)', { ids })
      .orderBy('unitType.position', 'ASC')
      .addOrderBy('unitType.code', 'ASC')
      .getMany();

    const agregados = await this.agregados(ids, publicOnly);

    const filas: UnitTypeSummary[] = tipologias
      .map((tipologia): UnitTypeSummary => {
        const datos = agregados.get(tipologia.id) ?? vacio();
        const esAuto = tipologia.kind === UnitTypeKind.AUTO;
        return {
          id: tipologia.id,
          code: tipologia.code,
          name: tipologia.name,
          description: tipologia.description,
          kind: tipologia.kind,
          propertyType: datos.propertyType,
          /*
            El suelo no tiene alcobas, y las suyas vienen a cero en la ficha del
            inmueble. Sin este corte la web pintaria "0 alcobas" en un lote, que
            no es un dato: es la ausencia de uno.
          */
          bedrooms: esAuto ? null : (tipologia.bedrooms ?? datos.bedrooms),
          bathrooms: esAuto ? null : tipologia.bathrooms,
          garages: esAuto ? null : tipologia.garages,
          builtArea: num(tipologia.builtArea),
          /*
            Manda lo escrito: si la agencia dice que el Tipo A son 58 m², son 58
            aunque una unidad venga mal medida. Solo cuando no hay rango escrito
            se cae a lo que miden de verdad las unidades.
          */
          minArea: num(tipologia.areaMin) ?? datos.minArea,
          maxArea: num(tipologia.areaMax) ?? datos.maxArea,
          units: datos.units,
          available: datos.available,
          minPrice: datos.minPrice,
          maxPrice: datos.maxPrice,
          position: tipologia.position,
          propertyId: datos.propertyId,
          coverUrl: datos.coverUrl,
        };
      })
      .filter((fila) => !publicOnly || fila.units > 0);

    /*
      Las unidades sin tipología van al final y en su propia fila. Callarlas
      seria peor que enseñarlas: el proyecto diria "12 unidades" cuando tiene
      quince, y las tres que faltan son justamente las que nadie ha clasificado.
    */
    const sueltas = agregados.get(null);
    if (sueltas && sueltas.units > 0) {
      filas.push({
        id: null,
        code: null,
        name: 'Sin clasificar',
        description: null,
        kind: null,
        propertyType: sueltas.propertyType,
        bedrooms: sueltas.bedrooms,
        bathrooms: null,
        garages: null,
        builtArea: null,
        minArea: sueltas.minArea,
        maxArea: sueltas.maxArea,
        units: sueltas.units,
        available: sueltas.available,
        minPrice: sueltas.minPrice,
        maxPrice: sueltas.maxPrice,
        position: 32767,
        propertyId: sueltas.propertyId,
        coverUrl: sueltas.coverUrl,
      });
    }

    return filas;
  }

  /**
   * Los números de cada tipología, agrupando los inmuebles del proyecto.
   *
   * El acotado por sede va aquí, en el QueryBuilder, y no filtrando después: si
   * se contara todo y se descartara luego, un coordinador leeria "20 unidades"
   * de las que solo alcanza ocho.
   */
  private async agregados(
    familyIds: string[],
    publicOnly: boolean,
  ): Promise<Map<string | null, Agregado>> {
    const qb = this.properties
      .createQueryBuilder('property')
      .innerJoin('property.propertyType', 'propertyType')
      .select('property.unit_type_id', 'unitTypeId')
      .addSelect('COUNT(*)::int', 'units')
      .addSelect(
        `COUNT(*) FILTER (WHERE property.availability = '${Availability.AVAILABLE}')::int`,
        'available',
      )
      .addSelect('MIN(property.area)', 'minArea')
      .addSelect('MAX(property.area)', 'maxArea')
      .addSelect('MIN(NULLIF(property.sale_price, 0))', 'minPrice')
      .addSelect('MAX(NULLIF(property.sale_price, 0))', 'maxPrice')
      .addSelect('MIN(NULLIF(property.bedrooms, 0))', 'bedrooms')
      .addSelect('MIN(propertyType.name)', 'propertyType')
      /*
        La representa la MAS BARATA, no la mas pequeña: es la que sostiene el
        "Desde $X" que se anuncia justo encima, y si fueran dos unidades
        distintas la web enseñaria un precio y abriria otro. El area desempata.

        Se saca su id y no su foto para no unir aqui la tabla de imagenes: un
        inmueble con dos portadas marcadas duplicaria su fila y el recuento de
        unidades saldria inflado.
      */
      .addSelect(
        `(ARRAY_AGG(property.id ORDER BY NULLIF(property.sale_price, 0) ASC NULLS LAST,
                                 property.area ASC NULLS LAST))[1]`,
        'propertyId',
      )
      .where('property.family_id IN (:...ids)', { ids: familyIds })
      .groupBy('property.unit_type_id');

    // La web pública enseña el proyecto entero; el panel, solo lo de su sede.
    if (!publicOnly) applyBranchScope(qb, 'property.branch_id');

    if (publicOnly) {
      qb.andWhere('property.publication_status IN (:...visible)', {
        visible: [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING],
      });
    }

    const rows = await qb.getRawMany<Record<string, string | number | null>>();
    const portadas = await this.portadasDe(
      rows.map((row) => row.propertyId as string | null),
    );

    return new Map(
      rows.map((row) => {
        const propertyId = (row.propertyId as string | null) ?? null;
        return [
          (row.unitTypeId as string | null) ?? null,
          {
            units: Number(row.units),
            available: Number(row.available),
            minArea: num(row.minArea),
            maxArea: num(row.maxArea),
            minPrice: num(row.minPrice),
            maxPrice: num(row.maxPrice),
            bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
            propertyType: (row.propertyType as string) ?? null,
            propertyId,
            coverUrl: (propertyId && portadas.get(propertyId)) ?? null,
          },
        ];
      }),
    );
  }

  /** La portada de cada unidad representativa, en una sola consulta. */
  private async portadasDe(
    propertyIds: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = propertyIds.filter((id): id is string => Boolean(id));
    if (!ids.length) return new Map();

    const rows = await this.properties.manager
      .createQueryBuilder(PropertyImage, 'image')
      .select('image.property_id', 'propertyId')
      .addSelect('image.url', 'url')
      .where('image.property_id IN (:...ids)', { ids })
      .andWhere('image.is_main = true')
      .getRawMany<{ propertyId: string; url: string }>();

    return new Map(rows.map((row) => [row.propertyId, row.url]));
  }

  /** Las tipologías tal cual, para el formulario que las edita. */
  async listOf(familyId: string): Promise<UnitType[]> {
    const ids = await this.families.descendantIds(familyId);
    return this.repo
      .createQueryBuilder('unitType')
      .where('unitType.family_id IN (:...ids)', { ids })
      .orderBy('unitType.position', 'ASC')
      .addOrderBy('unitType.code', 'ASC')
      .getMany();
  }

  // --- escritura ---------------------------------------------------------

  async create(familyId: string, dto: CreateUnitTypeDto): Promise<UnitType> {
    // `findById` ya acota por sede: crear en un proyecto de otra oficina
    // devuelve "no encontrado" y no una tipología cruzada.
    const family = await this.families.findById(familyId);
    assertSameBranch(this.actor(), family.branchId);

    const code = dto.code.trim().toUpperCase();
    await this.assertCodigoLibre(familyId, code);
    assertRango(dto.areaMin, dto.areaMax);

    return this.repo.save(
      this.repo.create({
        ...this.campos(dto),
        familyId,
        code,
        name: dto.name.trim(),
        kind: dto.kind ?? UnitTypeKind.FIXED,
        position: dto.position ?? (await this.siguientePosicion(familyId)),
      }),
    );
  }

  async update(id: string, dto: UpdateUnitTypeDto): Promise<UnitType> {
    const tipologia = await this.findById(id);

    const code = dto.code?.trim().toUpperCase();
    if (code && code !== tipologia.code) {
      await this.assertCodigoLibre(tipologia.familyId, code);
    }
    assertRango(
      dto.areaMin ?? num(tipologia.areaMin) ?? undefined,
      dto.areaMax ?? num(tipologia.areaMax) ?? undefined,
    );

    Object.assign(tipologia, this.campos(dto));
    if (code) tipologia.code = code;
    if (dto.name) tipologia.name = dto.name.trim();
    if (dto.kind) tipologia.kind = dto.kind;
    if (dto.position !== undefined) tipologia.position = dto.position;

    return this.repo.save(tipologia);
  }

  /** El orden en que la agencia quiere enseñarlas. */
  async reorder(familyId: string, dto: ReorderUnitTypesDto): Promise<void> {
    const family = await this.families.findById(familyId);
    assertSameBranch(this.actor(), family.branchId);

    const ids = await this.families.descendantIds(familyId);
    const propias = await this.repo.find({
      where: { familyId: In(ids) },
      select: { id: true },
    });
    const conocidas = new Set(propias.map((t) => t.id));

    const ajenas = dto.unitTypeIds.filter((id) => !conocidas.has(id));
    if (ajenas.length) {
      throw new BadRequestException(
        `Esas tipologías no son de este proyecto: ${ajenas.join(', ')}`,
      );
    }

    await this.repo.manager.transaction(async (manager) => {
      for (const [posicion, id] of dto.unitTypeIds.entries()) {
        await manager.update(UnitType, { id }, { position: posicion });
      }
    });
  }

  /**
   * Borra la tipología; sus inmuebles se quedan sin ella.
   *
   * Borrado real y no lógico, al revés que en el resto: la tipología no tiene
   * historia comercial que conservar, y una fila marcada como borrada seguiria
   * ocupando su `code` —`UNIQUE (family_id, code)` no distingue borrados— de
   * modo que no se podria volver a crear el "Tipo A" que se acaba de quitar.
   * Al desaparecer la fila, el `ON DELETE SET NULL` de la base deja los
   * inmuebles sin tipología sin tocar nada mas de ellos.
   */
  async remove(id: string): Promise<void> {
    const tipologia = await this.findById(id);
    await this.repo.delete({ id: tipologia.id });
  }

  /**
   * La tipología, si la sede en curso alcanza su proyecto.
   *
   * El acotado se hace contra el proyecto porque la tipología no lleva sede
   * propia: es del proyecto, y el proyecto sí la lleva.
   */
  async findById(id: string): Promise<UnitType> {
    const tipologia = await this.repo.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!tipologia) {
      throw new NotFoundException(`Tipología ${id} no encontrada`);
    }
    // `findById` del proyecto ya acota por sede: si es de otra oficina, la
    // tipologia deja de existir aqui igual que su proyecto.
    const family = await this.families.findById(tipologia.familyId);
    assertSameBranch(this.actor(), family.branchId);
    return tipologia;
  }

  /**
   * Comprueba que la tipología es del mismo proyecto que el inmueble.
   *
   * Es el fallo facil de esta funcionalidad: asignar al apartamento de un
   * edificio el "Tipo A" de otro deja la ficha enseñando un plano que no es
   * suyo, y nada en la base lo impide —la clave foranea solo mira que la
   * tipología exista—. Devuelve el id ya validado, o null para desvincular.
   */
  async resolveForProperty(
    unitTypeId: string | null | undefined,
    familyId: string | null,
  ): Promise<string | null> {
    if (!unitTypeId) return null;
    if (!familyId) {
      throw new BadRequestException(
        'El inmueble no pertenece a ningún proyecto: no puede tener tipología',
      );
    }

    const tipologia = await this.repo.findOne({
      where: { id: unitTypeId },
      select: { id: true, familyId: true, name: true },
    });
    if (!tipologia) {
      throw new NotFoundException(`Tipología ${unitTypeId} no encontrada`);
    }
    if (tipologia.familyId !== familyId) {
      throw new BadRequestException(
        `La tipología "${tipologia.name}" es de otro proyecto: elige una del proyecto del inmueble`,
      );
    }
    return tipologia.id;
  }

  // --- interno -----------------------------------------------------------

  /** Los campos numéricos, con los `numeric` de Postgres como cadena. */
  private campos(dto: UpdateUnitTypeDto): Partial<UnitType> {
    const campos: Partial<UnitType> = {};
    if (dto.description !== undefined)
      campos.description = dto.description.trim() || null;
    if (dto.bedrooms !== undefined) campos.bedrooms = dto.bedrooms;
    if (dto.bathrooms !== undefined) campos.bathrooms = dto.bathrooms;
    if (dto.garages !== undefined) campos.garages = dto.garages;
    if (dto.areaMin !== undefined) campos.areaMin = dto.areaMin.toString();
    if (dto.areaMax !== undefined) campos.areaMax = dto.areaMax.toString();
    if (dto.builtArea !== undefined)
      campos.builtArea = dto.builtArea.toString();
    return campos;
  }

  private async assertCodigoLibre(
    familyId: string,
    code: string,
  ): Promise<void> {
    const existe = await this.repo.findOne({
      where: { familyId, code },
      select: { id: true },
    });
    if (existe) {
      throw new ConflictException(
        `Ya hay una tipología "${code}" en este proyecto`,
      );
    }
  }

  private async siguientePosicion(familyId: string): Promise<number> {
    const { max } = (await this.repo
      .createQueryBuilder('unitType')
      .select('COALESCE(MAX(unitType.position), -1)', 'max')
      .where('unitType.family_id = :familyId', { familyId })
      .getRawOne<{ max: string }>()) ?? { max: '-1' };
    return Number(max) + 1;
  }

  private actor(): AuthenticatedActor {
    const actor = RequestContext.actor();
    if (!actor) {
      throw new ForbiddenException('Esta operación requiere sesión');
    }
    return actor;
  }
}

function assertRango(min?: number, max?: number): void {
  if (min !== undefined && max !== undefined && min > max) {
    throw new BadRequestException(
      'El área mínima no puede ser mayor que la máxima',
    );
  }
}

function vacio(): Agregado {
  return {
    units: 0,
    available: 0,
    minArea: null,
    maxArea: null,
    minPrice: null,
    maxPrice: null,
    bedrooms: null,
    propertyType: null,
    propertyId: null,
    coverUrl: null,
  };
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
