import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { FeatureScope } from './domain/catalogs.entity';

@ApiTags('catalogs')
@Controller('catalogs')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('property-types')
  propertyTypes() {
    return this.catalog.listPropertyTypes();
  }

  @Get('features')
  @ApiQuery({ name: 'scope', enum: FeatureScope, required: false })
  features(@Query('scope') scope?: FeatureScope) {
    return this.catalog.listFeatures(scope);
  }

  @Get('currencies')
  currencies() {
    return this.catalog.listCurrencies();
  }

  @Get('client-types')
  clientTypes() {
    return this.catalog.listClientTypes();
  }

  @Get('portals')
  portals() {
    return this.catalog.listPortals();
  }

  @Get('geo/countries')
  countries() {
    return this.catalog.listCountries();
  }

  @Get('geo/regions')
  @ApiQuery({ name: 'countryId', required: false, type: Number })
  regions(
    @Query('countryId', new ParseIntPipe({ optional: true }))
    countryId?: number,
  ) {
    return this.catalog.listRegions(countryId);
  }

  @Get('geo/cities')
  @ApiQuery({ name: 'regionId', required: false, type: Number })
  cities(
    @Query('regionId', new ParseIntPipe({ optional: true })) regionId?: number,
  ) {
    return this.catalog.listCities(regionId);
  }

  @Get('geo/zones')
  @ApiQuery({ name: 'cityId', required: false, type: Number })
  zones(
    @Query('cityId', new ParseIntPipe({ optional: true })) cityId?: number,
  ) {
    return this.catalog.listZones(cityId);
  }

  @Get('bootstrap')
  @ApiOperation({
    summary:
      'Todos los catalogos que necesita el formulario de alta, en una sola llamada',
  })
  async bootstrap() {
    const [propertyTypes, features, currencies, clientTypes, portals, cities] =
      await Promise.all([
        this.catalog.listPropertyTypes(),
        this.catalog.listFeatures(),
        this.catalog.listCurrencies(),
        this.catalog.listClientTypes(),
        this.catalog.listPortals(),
        this.catalog.listCities(),
      ]);
    return {
      propertyTypes,
      features,
      currencies,
      clientTypes,
      portals,
      cities,
    };
  }
}
