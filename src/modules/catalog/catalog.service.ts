import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { City, Country, Region, Zone } from './domain/geography.entity';
import {
  ClientType,
  Currency,
  Feature,
  FeatureScope,
  Portal,
  PropertyType,
} from './domain/catalogs.entity';

/**
 * Los catalogos casi no cambian, asi que se sirven desde una cache en memoria
 * con invalidacion manual: evita 6 consultas por cada carga del formulario de
 * alta de inmueble.
 */
@Injectable()
export class CatalogService {
  private cache = new Map<string, { at: number; value: unknown }>();
  private static readonly TTL_MS = 10 * 60 * 1000;

  constructor(
    @InjectRepository(Country) private readonly countries: Repository<Country>,
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    @InjectRepository(City) private readonly cities: Repository<City>,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(PropertyType)
    private readonly propertyTypes: Repository<PropertyType>,
    @InjectRepository(Feature) private readonly features: Repository<Feature>,
    @InjectRepository(Currency)
    private readonly currencies: Repository<Currency>,
    @InjectRepository(ClientType)
    private readonly clientTypes: Repository<ClientType>,
    @InjectRepository(Portal) private readonly portals: Repository<Portal>,
  ) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CatalogService.TTL_MS)
      return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  invalidate(): void {
    this.cache.clear();
  }

  listCountries() {
    return this.cached('countries', () =>
      this.countries.find({ order: { name: 'ASC' } }),
    );
  }

  listRegions(countryId?: number) {
    const key = `regions:${countryId ?? 'all'}`;
    return this.cached(key, () =>
      this.regions.find({
        where: countryId ? { countryId } : {},
        order: { name: 'ASC' },
      }),
    );
  }

  listCities(regionId?: number) {
    const key = `cities:${regionId ?? 'all'}`;
    return this.cached(key, () =>
      this.cities.find({
        where: regionId ? { regionId } : {},
        order: { name: 'ASC' },
      }),
    );
  }

  listZones(cityId?: number) {
    const key = `zones:${cityId ?? 'all'}`;
    return this.cached(key, () =>
      this.zones.find({
        where: cityId ? { cityId } : {},
        order: { name: 'ASC' },
      }),
    );
  }

  listPropertyTypes(onlyActive = true) {
    return this.cached(`property-types:${onlyActive}`, () =>
      this.propertyTypes.find({
        where: onlyActive ? { active: true } : {},
        order: { name: 'ASC' },
      }),
    );
  }

  listFeatures(scope?: FeatureScope) {
    return this.cached(`features:${scope ?? 'all'}`, () =>
      this.features.find({
        where: scope ? { scope } : {},
        order: { scope: 'ASC', name: 'ASC' },
      }),
    );
  }

  listCurrencies() {
    return this.cached('currencies', () =>
      this.currencies.find({ order: { iso: 'ASC' } }),
    );
  }

  listClientTypes() {
    return this.cached('client-types', () =>
      this.clientTypes.find({ order: { name: 'ASC' } }),
    );
  }

  listPortals() {
    return this.cached('portals', () =>
      this.portals.find({ order: { name: 'ASC' } }),
    );
  }

  /** Comprueba de una sola pasada que los ids enviados en un alta existen. */
  async assertReferences(refs: {
    propertyTypeId?: number;
    currencyId?: number;
    cityId?: number;
    zoneId?: number | null;
    featureIds?: number[];
  }): Promise<void> {
    if (refs.propertyTypeId !== undefined) {
      const exists = await this.propertyTypes.exists({
        where: { id: refs.propertyTypeId },
      });
      if (!exists)
        throw new NotFoundException(
          `Tipo de inmueble ${refs.propertyTypeId} inexistente`,
        );
    }
    if (refs.currencyId !== undefined) {
      const exists = await this.currencies.exists({
        where: { id: refs.currencyId },
      });
      if (!exists)
        throw new NotFoundException(`Moneda ${refs.currencyId} inexistente`);
    }
    if (refs.cityId !== undefined) {
      const exists = await this.cities.exists({ where: { id: refs.cityId } });
      if (!exists)
        throw new NotFoundException(`Ciudad ${refs.cityId} inexistente`);
    }
    if (refs.zoneId) {
      const zone = await this.zones.findOne({ where: { id: refs.zoneId } });
      if (!zone) throw new NotFoundException(`Zona ${refs.zoneId} inexistente`);
      if (refs.cityId !== undefined && zone.cityId !== refs.cityId) {
        throw new NotFoundException(
          `La zona ${refs.zoneId} no pertenece a la ciudad ${refs.cityId}`,
        );
      }
    }
    if (refs.featureIds?.length) {
      const found = await this.features.count({
        where: refs.featureIds.map((id) => ({ id })),
      });
      if (found !== new Set(refs.featureIds).size) {
        throw new NotFoundException(
          'Alguna de las caracteristicas enviadas no existe',
        );
      }
    }
  }

  async isEmpty(): Promise<boolean> {
    return (await this.propertyTypes.count()) === 0;
  }
}
