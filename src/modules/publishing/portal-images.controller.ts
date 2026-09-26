import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import { Public } from '../iam/decorators';
import { StorageService } from '../media/storage.service';

const FILE = /^([0-9a-f-]{36})-l(?:\.([a-z0-9]{1,16}))?\.jpg$/;
const UUID = /^[0-9a-f-]{36}$/;

/**
 * Las fotos del inventario en JPG, para los portales.
 *
 * Todo lo nuestro es WebP y hay portales que no lo aceptan. Convertir al
 * guardar duplicaria el almacenamiento de 6.300 fotos para un uso que solo
 * tienen los portales; aqui se convierte la primera vez que un portal la pide
 * y se guarda al lado, en una carpeta propia fuera de `uploads/`.
 *
 * Publica y sin limite de peticiones: quien descarga es el robot del portal,
 * que baja las veinte fotos de un anuncio de golpe desde una sola IP.
 */
@Public()
@SkipThrottle()
@ApiExcludeController()
@Controller('public/portal-images')
export class PortalImagesController {
  private readonly cacheRoot: string;

  constructor(private readonly storage: StorageService) {
    this.cacheRoot = resolve(
      storage.root,
      '..',
      `${basename(storage.root)}-jpg`,
    );
  }

  @Get('properties/:propertyId/:file')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(
    @Param('propertyId') propertyId: string,
    @Param('file') file: string,
  ): Promise<StreamableFile> {
    const match = FILE.exec(file);
    if (!UUID.test(propertyId) || !match) throw new NotFoundException();

    const source = this.storage.absolute(
      `properties/${propertyId}/${match[1]}-l.webp`,
    );
    const dir = join(this.cacheRoot, propertyId);
    const target = join(dir, file);

    if (!(await exists(target))) {
      if (!(await exists(source))) throw new NotFoundException();
      await mkdir(dir, { recursive: true });
      // Se escribe aparte y se renombra: dos peticiones a la vez no dejan un
      // JPG a medias que se serviria para siempre con cache de un año.
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await sharp(source)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(tmp);
      await rename(tmp, target);
    }
    return new StreamableFile(createReadStream(target));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
