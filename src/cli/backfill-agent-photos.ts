import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { StorageService } from '../modules/media/storage.service';
import { Agent } from '../modules/iam/domain/agent.entity';
import { DataSource } from 'typeorm';

/**
 * Trae al servidor las fotos de perfil que seguian colgando de WASI.
 *
 * La importacion se trajo las 6.306 fotos del inventario pero dejo las de los
 * asesores apuntando a images.wasi.co. Eso significaba tres cosas: la ficha
 * publica se veia rota en cuanto WASI retirara la imagen, la politica de
 * seguridad del navegador la bloqueaba —era el unico error en consola del
 * sitio—, y la cuenta de WASI seguia siendo una dependencia de una web que ya
 * no la usa.
 *
 * Es idempotente: quien ya tenga la foto en /media/ se salta.
 */
async function main() {
  const logger = new Logger('fotos-asesores');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const storage = app.get(StorageService);
    const repo = app.get(DataSource).getRepository(Agent);

    const agents = await repo.find({
      select: { id: true, fullName: true, photoUrl: true },
    });

    const pending = agents.filter(
      (agent) => agent.photoUrl && !agent.photoUrl.startsWith('/media/'),
    );

    console.log(
      `  ${agents.length} asesores, ${pending.length} con foto ajena`,
    );
    if (!pending.length) return;

    for (const agent of pending) {
      const stored = await storage.saveFromUrl(agent.photoUrl!, 'agents');
      if (!stored) {
        logger.warn(`${agent.fullName}: no se pudo traer ${agent.photoUrl}`);
        continue;
      }

      // La de perfil se enseña a 96 px como mucho: basta la variante pequeña.
      await repo.update({ id: agent.id }, { photoUrl: stored.url });
      console.log(`  ${agent.fullName} -> ${stored.url}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nFallo:', error instanceof Error ? error.message : error);
  process.exit(1);
});
