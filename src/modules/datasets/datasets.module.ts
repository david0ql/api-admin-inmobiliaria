import { Module } from '@nestjs/common';
import { DatasetsService } from './datasets.service';
import { DatasetsController } from './datasets.controller';

/**
 * Hojas de datos para la vista de hoja de calculo.
 *
 * No registra ninguna entidad con `TypeOrmModule.forFeature`: las consultas van
 * contra el `DataSource` y las entidades de otros modulos solo se usan como
 * metadatos para armar los joins. Es de lectura, y no tiene por que poder
 * escribir en ningun repositorio.
 */
@Module({
  controllers: [DatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
