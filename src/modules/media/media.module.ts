import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AppConfigService } from '../../shared/config/app-config.service';
import { StorageService } from './storage.service';

@Module({
  imports: [
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
  providers: [StorageService],
  exports: [StorageService, MulterModule],
})
export class MediaModule {}
