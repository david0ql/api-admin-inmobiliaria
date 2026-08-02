import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';
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

  // `robots.txt` y `sitemap.xml` tienen que vivir en la raiz del dominio: un
  // buscador no los busca bajo /api/v1. `render` va con ellos porque devuelve
  // paginas del sitio, no datos, y nginx lo pide por la ruta publica.
  app.setGlobalPrefix(config.apiPrefix, {
    exclude: ['robots.txt', 'sitemap.xml', 'render/:slug/:code'],
  });

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
    setHeaders(res: ServerResponse, path: string) {
      // Aunque todo lo que entra se inspecciona y las imagenes se reencodean,
      // el servido asume que un fichero pudo colarse: el navegador no debe
      // adivinar el tipo, no debe ejecutar nada y no debe renderizar en este
      // origen. Es la ultima linea, y es la barata.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; sandbox; frame-ancestors 'none'",
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // Los documentos se descargan, nunca se abren dentro de la aplicacion:
      // un PDF renderizado en el mismo origen es un vector de robo de sesion.
      if (!path.endsWith('.webp')) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
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
