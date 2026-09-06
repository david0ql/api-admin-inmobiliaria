import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaModule } from '../media/media.module';
import { OpenAiProvider } from '../assistant/openai-provider';
import { Property } from '../properties/domain/property.entity';
import { PropertyImage } from '../properties/domain/property-image.entity';
import { ImagePrompt } from './domain/image-prompt.entity';
import { ImageAnalysis } from './domain/image-analysis.entity';
import { ImageAlbumAnalysis } from './domain/image-album-analysis.entity';
import { ImagePromptService } from './image-prompt.service';
import { ImageAnalysisService } from './image-analysis.service';
import { SamplesService } from './samples.service';
import { ImageAiController } from './image-ai.controller';

/**
 * Calidad de las fotos de un inmueble: primero el codigo, luego la IA.
 *
 * Dos mitades con dos costes distintos, y por eso van juntas:
 *
 * La puerta de codigo —`ImageGateService`— NO vive aqui, vive en `MediaModule`:
 * mide con sharp, no llama a nadie, no cuesta nada y se ejecuta en TODA subida,
 * venga del equipo o de un propietario rellenando el formulario de la web. Su
 * sitio es junto a quien guarda los ficheros.
 *
 * Lo de aqui es la otra mitad: el analisis con IA, que cuesta dinero por imagen
 * y solo lo dispara el personal de la plataforma desde `ImageAiController`, que
 * no tiene ni una ruta publica.
 *
 * No importa `PropertiesModule` a proposito, aunque lea inmuebles y fotos: lo
 * hace por sus repositorios, no por su servicio. Si lo importara, y el modulo
 * de inmuebles importa este para usar la puerta, tendriamos un ciclo — y los
 * ciclos de modulos en Nest se manifiestan como una dependencia `undefined` en
 * tiempo de ejecucion, que es de las cosas mas caras de diagnosticar.
 *
 * `OpenAiProvider` se declara aqui como proveedor en vez de importar
 * `AssistantModule` entero: lo que hace falta es la clase que ya sabe hablar
 * con el proveedor —misma clave, misma URL base, mismo trato de errores— y no
 * el asistente de la web con sus herramientas, su historial y sus entidades. Es
 * una clase sin estado que solo depende de la configuracion, asi que tener otra
 * instancia no significa otra conexion ni otra clave.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ImagePrompt,
      ImageAnalysis,
      ImageAlbumAnalysis,
      Property,
      PropertyImage,
    ]),
    MediaModule,
  ],
  controllers: [ImageAiController],
  providers: [
    ImagePromptService,
    ImageAnalysisService,
    SamplesService,
    OpenAiProvider,
  ],
})
export class ImageAiModule {}
