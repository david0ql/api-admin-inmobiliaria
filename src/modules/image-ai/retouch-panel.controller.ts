import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../iam/decorators';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ImageRetouchService } from './image-retouch.service';
import { aPanel } from './retouch-panel.contract';
import { RetouchDto } from './dto/image-retouch.dto';

/**
 * Las rutas que consume el panel, tal y como el panel las escribio.
 *
 * Es un controlador aparte y no mas metodos en `ImageAiController`, y no es
 * duplicidad: son dos publicos distintos. `ImageAiController` es el modulo de
 * imagenes completo —analisis, prompts, umbrales, muestras— y habla en sus
 * propios terminos. Esto es la superficie minima que necesita UNA pantalla, con
 * los nombres que esa pantalla ya tiene escritos y compilando.
 *
 * Que las rutas se acomoden a la pantalla y no al reves fue deliberado: la
 * pantalla ya estaba publicada y su diseño era mejor que el que yo tenia. Ella
 * sondea, porque una edicion tarda entre 90 y 100 segundos y una peticion
 * sincrona de minuto y medio no sobrevive al `proxy_read_timeout` de nginx.
 *
 * Toda la logica vive en `ImageRetouchService`; aqui solo se traduce.
 */
@ApiTags('image-ai')
@Controller('image-ai/retoque')
export class RetouchPanelController {
  constructor(private readonly retouch: ImageRetouchService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Si el retoque esta disponible y lo que cuesta',
    description:
      'El coste va ANTES de pulsar y con su moneda al lado. `costeAnalisis` viene para poder decir cuantas veces mas cuesta esto que analizar la misma foto: la cifra sola no le dice nada a un asesor.',
  })
  status() {
    return this.retouch.estadoParaPanel();
  }

  @Get('images/:imageId')
  @ApiOperation({
    summary: 'El retoque que manda ahora en una foto',
    description:
      '404 si no hay ninguno vivo. Mientras `estado` sea PROCESANDO todavia no ha contestado el proveedor y `coste` va nulo, porque aun no se sabe.',
  })
  async actual(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return aPanel(await this.retouch.actualPorImagen(imageId, actor));
  }

  @Post('images/:imageId')
  @ApiOperation({
    summary: 'Lanzar el retoque de una foto',
    description:
      'Devuelve al instante una fila en PROCESANDO y sigue por detras; la edicion tarda entre 90 y 100 segundos. Se cobra. Sin `instruction` se hace un revelado conservador —luz, color, contraste—, que es el unico retoque que no altera lo que hay. Para cambiar la escena hace falta mandar la instruccion Y `alteracionAsumida`.',
  })
  async crear(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: RetouchDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return aPanel(await this.retouch.retocar(imageId, dto, actor));
  }

  @Post(':retoqueId/accept')
  @ApiOperation({
    summary: 'Aceptar: pasa a ser la foto del anuncio',
    description:
      'La foto queda marcada (`aiEdited`) y el original se conserva entero: volver atras sigue siendo posible despues de aceptar.',
  })
  async aceptar(
    @Param('retoqueId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return aPanel(await this.retouch.aplicar(id, actor));
  }

  @Post(':retoqueId/discard')
  @ApiOperation({ summary: 'Descartar el resultado sin publicarlo' })
  async descartar(
    @Param('retoqueId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return aPanel(await this.retouch.descartar(id, actor));
  }

  @Delete('images/:imageId')
  @ApiOperation({
    summary: 'Volver a la foto original',
    description:
      'Siempre posible, tambien despues de aceptar, y no cuesta nada: los ficheros del original nunca se borran.',
  })
  async volverAlOriginal(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    return aPanel(await this.retouch.revertirPorImagen(imageId, actor));
  }
}
