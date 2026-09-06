import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DatasetsService } from './datasets.service';
import { DatasetQueryDto } from './datasets.dto';
import { NOMBRES_HOJA } from './hojas';
import { CurrentUser } from '../iam/decorators';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * Los datos que alimentan la hoja de calculo de la web.
 *
 * Dos rutas y nada mas: uno pregunta que hojas hay y la otra sirve una. Las dos
 * son de LECTURA — no existe forma de escribir en el CRM desde la hoja, que es
 * justo lo que hace que el usuario pueda trastear con ella sin miedo.
 *
 * No llevan `@Roles`: cada hoja aplica el mismo acotado que su pantalla del CRM
 * —sede y asesor, en el QueryBuilder— asi que quien abre la hoja ve exactamente
 * lo que ya veia, ni una fila mas. Poner un rol aqui ademas del acotado seria
 * una segunda regla que mantener y que algun dia diria algo distinto de la
 * primera.
 */
@ApiTags('datasets')
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  @ApiOperation({
    summary: 'Qué hojas hay, con sus columnas y cuántas filas tiene cada una',
    description:
      'Sirve para montar las pestañas de la hoja sin que la interfaz tenga ' +
      'que saberse los conjuntos de memoria. Los nombres de columna vienen ' +
      'en español y ya listos para la cabecera.',
  })
  catalogo(@CurrentUser() actor: AuthenticatedActor) {
    return this.datasets.catalogo(actor);
  }

  @Get(':nombre')
  @ApiParam({ name: 'nombre', enum: NOMBRES_HOJA })
  @ApiOperation({
    summary: 'Las filas de una hoja, planas y listas para volcar',
    description:
      'Por defecto vienen como arrays paralelos a `columns`, que es lo que ' +
      'quiere una rejilla y lo que menos ocupa. Si la hoja no cabe entera, ' +
      '`truncated` lo avisa y `nextOffset` dice por dónde seguir.',
  })
  hoja(
    @Param('nombre') nombre: string,
    @Query() dto: DatasetQueryDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return this.datasets.hoja(nombre, dto, actor);
  }
}
