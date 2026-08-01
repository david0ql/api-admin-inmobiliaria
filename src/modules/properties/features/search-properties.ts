import { BadRequestException } from '@nestjs/common';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import { Property } from '../domain/property.entity';
import {
  PropertySort,
  SearchPropertiesDto,
} from '../dto/search-properties.dto';

const isTrue = (v?: string) => v === 'true';
const isFalse = (v?: string) => v === 'false';

/**
 * Traduce los filtros del listado a condiciones SQL.
 *
 * Todo se resuelve en la consulta — nada de filtrar en memoria — para que
 * `total` y la paginacion sigan siendo ciertos con cualquier combinacion.
 */
export function applyPropertyFilters(
  qb: SelectQueryBuilder<Property>,
  dto: SearchPropertiesDto,
): SelectQueryBuilder<Property> {
  if (dto.q?.trim()) {
    // La columna generada `search_text` ya viene en minusculas y concatenada.
    qb.andWhere('property.search_text LIKE :q', {
      q: `%${dto.q.trim().toLowerCase()}%`,
    });
  }

  if (dto.cityId?.length)
    qb.andWhere('property.city_id IN (:...cityIds)', { cityIds: dto.cityId });
  if (dto.zoneId?.length)
    qb.andWhere('property.zone_id IN (:...zoneIds)', { zoneIds: dto.zoneId });
  if (dto.propertyTypeId?.length) {
    qb.andWhere('property.property_type_id IN (:...typeIds)', {
      typeIds: dto.propertyTypeId,
    });
  }

  if (dto.availability?.length) {
    qb.andWhere('property.availability IN (:...availability)', {
      availability: dto.availability,
    });
  }
  if (dto.publicationStatus?.length) {
    qb.andWhere('property.publication_status IN (:...pubStatus)', {
      pubStatus: dto.publicationStatus,
    });
  }
  if (dto.condition)
    qb.andWhere('property.condition = :condition', {
      condition: dto.condition,
    });
  if (dto.assignedAgentId) {
    qb.andWhere('property.assigned_agent_id = :agentId', {
      agentId: dto.assignedAgentId,
    });
  }
  if (dto.labelId)
    qb.andWhere('property.label_id = :labelId', { labelId: dto.labelId });

  if (isTrue(dto.forSale)) qb.andWhere('property.for_sale = true');
  if (isFalse(dto.forSale)) qb.andWhere('property.for_sale = false');
  if (isTrue(dto.forRent)) qb.andWhere('property.for_rent = true');
  if (isFalse(dto.forRent)) qb.andWhere('property.for_rent = false');

  if (isTrue(dto.hasVideo))
    qb.andWhere("property.video_url IS NOT NULL AND property.video_url <> ''");
  if (isTrue(dto.hasTour))
    qb.andWhere("property.tour_url IS NOT NULL AND property.tour_url <> ''");

  // El precio relevante depende del negocio: si se pide arriendo se filtra por
  // el canon, si no por el precio de venta.
  const priceColumn = isTrue(dto.forRent)
    ? 'property.rent_price'
    : 'property.sale_price';
  if (dto.minPrice !== undefined)
    qb.andWhere(`${priceColumn} >= :minPrice`, { minPrice: dto.minPrice });
  if (dto.maxPrice !== undefined)
    qb.andWhere(`${priceColumn} <= :maxPrice`, { maxPrice: dto.maxPrice });

  if (dto.minArea !== undefined)
    qb.andWhere('property.area >= :minArea', { minArea: dto.minArea });
  if (dto.maxArea !== undefined)
    qb.andWhere('property.area <= :maxArea', { maxArea: dto.maxArea });

  if (dto.bedrooms !== undefined)
    qb.andWhere('property.bedrooms >= :bedrooms', { bedrooms: dto.bedrooms });
  if (dto.bathrooms !== undefined) {
    qb.andWhere('property.bathrooms >= :bathrooms', {
      bathrooms: dto.bathrooms,
    });
  }
  if (dto.garages !== undefined)
    qb.andWhere('property.garages >= :garages', { garages: dto.garages });
  if (dto.stratum !== undefined)
    qb.andWhere('property.stratum = :stratum', { stratum: dto.stratum });

  if (dto.bbox) {
    const parts = dto.bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new BadRequestException(
        'bbox debe ser minLng,minLat,maxLng,maxLat',
      );
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    qb.andWhere(
      new Brackets((w) =>
        w
          .where('property.longitude BETWEEN :minLng AND :maxLng', {
            minLng,
            maxLng,
          })
          .andWhere('property.latitude BETWEEN :minLat AND :maxLat', {
            minLat,
            maxLat,
          }),
      ),
    );
  }

  if (dto.featureId?.length) {
    // "Debe tener TODAS las caracteristicas pedidas", no cualquiera: se cuenta
    // cuantas de las solicitadas tiene y se exige el total.
    const unique = [...new Set(dto.featureId)];
    qb.andWhere(
      `(SELECT COUNT(*) FROM property_feature pf
          WHERE pf.property_id = property.id AND pf.feature_id IN (:...featureIds)) = :featureCount`,
      { featureIds: unique, featureCount: unique.length },
    );
  }

  return qb;
}

export function applyPropertySort(
  qb: SelectQueryBuilder<Property>,
  sort: PropertySort = PropertySort.RECENT,
): SelectQueryBuilder<Property> {
  switch (sort) {
    case PropertySort.PRICE_ASC:
      qb.orderBy('property.sale_price', 'ASC', 'NULLS LAST');
      break;
    case PropertySort.PRICE_DESC:
      qb.orderBy('property.sale_price', 'DESC', 'NULLS LAST');
      break;
    case PropertySort.AREA_DESC:
      qb.orderBy('property.area', 'DESC', 'NULLS LAST');
      break;
    case PropertySort.VISITS_DESC:
      qb.orderBy('property.visits', 'DESC');
      break;
    default:
      qb.orderBy('property.created_at', 'DESC');
  }
  // Desempate estable: sin esto la paginacion puede repetir u omitir filas
  // cuando varios inmuebles comparten precio o fecha.
  return qb.addOrderBy('property.id', 'DESC');
}
