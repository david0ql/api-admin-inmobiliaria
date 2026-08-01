import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { SnakeNamingStrategy } from './snake-naming.strategy';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const db = config.database;
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          logging: db.logging,
          synchronize: false,
          autoLoadEntities: true,
          namingStrategy: new SnakeNamingStrategy(),
          migrationsRun: false,
          // Los timestamps se guardan siempre en UTC; la conversion a hora de
          // Bogota es responsabilidad del cliente.
          extra: { timezone: 'UTC' },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
