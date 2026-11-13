import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { ALL_MIGRATIONS } from './migrations';
import { SnakeNamingStrategy } from './snake-naming.strategy';

export interface DbConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Общие опции подключения для приложения (NestJS) и для CLI миграций (data-source.ts).
 * synchronize ВСЕГДА выключен: схему меняют только миграции.
 */
export function buildBaseOptions(params: DbConnectionParams): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password,
    database: params.database,
    namingStrategy: new SnakeNamingStrategy(),
    migrations: [...ALL_MIGRATIONS],
    migrationsTableName: 'migrations',
    synchronize: false,
    // UUID генерируются самой БД (gen_random_uuid(), встроено в PostgreSQL 13+)
    installExtensions: false,
    logging: ['error', 'warn', 'migration'],
  };
}
