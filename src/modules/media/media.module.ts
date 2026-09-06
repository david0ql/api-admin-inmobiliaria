import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { AppConfigService } from '../../shared/config/app-config.service';
import { StorageService } from './storage.service';
import { FileSecurityService } from './file-security.service';
import { ImageCollectionService } from './image-collection.service';
import { ImageGateSettings } from './image-gate-settings.entity';
import { GateSettingsService } from './gate-settings.service';
import { ImageGateService } from './image-gate.service';

/*
  La puerta de calidad vive aqui y no en `image-ai`.

  Es codigo puro sobre pixeles —sharp, nada de modelos, nada de coste— y la usa
  todo el que guarda una imagen: el inventario, la galeria de un proyecto y el
  formulario de consignacion de la web. Ponerla en el modulo de IA obligaria a
  que `MediaModule` lo importara, y `image-ai` importa a `MediaModule`: un ciclo
  que en Nest no falla al arrancar, sino que deja una dependencia en `undefined`
  y revienta a mitad de una subida.
*/
@Module({
  imports: [
    TypeOrmModule.forFeature([ImageGateSettings]),
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // En memoria y no en disco: `StorageService` valida, recomprime y
        // decide el nombre. Escribir primero el fichero crudo dejaria basura
        // en `uploads/` cada vez que una subida se rechaza.
        storage: memoryStorage(),
        limits: {
          fileSize: config.uploadMaxBytes,
          files: 30,
        },
      }),
    }),
  ],
  providers: [
    StorageService,
    FileSecurityService,
    ImageCollectionService,
    GateSettingsService,
    ImageGateService,
  ],
  exports: [
    StorageService,
    FileSecurityService,
    ImageCollectionService,
    GateSettingsService,
    ImageGateService,
    MulterModule,
  ],
})
export class MediaModule {}
