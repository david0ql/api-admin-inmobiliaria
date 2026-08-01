import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.schema';
import { SnakeNamingStrategy } from './snake-naming.strategy';

loadDotenv();
const env = validateEnv(process.env);

/**
 * DataSource usado exclusivamente por el CLI de TypeORM (generar/correr
 * migraciones) y por los comandos de seed e importacion. La aplicacion usa
 * `DatabaseModule`, que lee la misma configuracion.
 */
export const dataSourceOptions = {
  type: 'postgres' as const,
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  username: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  // Nunca en true: el esquema se gobierna solo con migraciones.
  synchronize: false,
  logging: env.DATABASE_LOGGING,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [join(__dirname, '..', '..', 'modules', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
};

// Un unico export de DataSource en el fichero: el CLI de TypeORM lo exige.
export const AppDataSource = new DataSource(dataSourceOptions);
