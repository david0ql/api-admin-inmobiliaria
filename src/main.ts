import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';
import { StorageService } from './modules/media/storage.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfigService);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix(config.apiPrefix);

  // Las fotos del inventario se sirven desde el propio servidor. Se cachean un
  // ano porque el nombre del fichero lleva un uuid: si cambia la imagen, cambia
  // la ruta.
  const storage = app.get(StorageService);
  await storage.ensureRoot();
  app.useStaticAssets(storage.root, {
    prefix: '/media/',
    maxAge: '365d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta cualquier campo no declarado en el DTO en lugar de guardarlo.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Un cierre limpio evita cortar las peticiones en vuelo al desplegar.
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Serrano Inmobiliaria — API')
    .setDescription(
      'CRM/ERP inmobiliario: inventario, portales, embudo comercial y agenda. ' +
        'Todas las rutas requieren token salvo las marcadas como publicas.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swagger),
    {
      swaggerOptions: { persistAuthorization: true },
    },
  );

  await app.listen(config.port);
  const url = await app.getUrl();
  console.log(`API en ${url}/${config.apiPrefix}`);
  console.log(`Documentacion en ${url}/api/docs`);
  console.log(`Imagenes en ${url}/media  ->  ${storage.root}`);
}

void bootstrap();
