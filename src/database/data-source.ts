import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildBaseOptions } from './typeorm-options';

/**
 * DataSource для CLI TypeORM (миграции). Читает backend/.env.
 * Приложение NestJS использует те же опции через buildBaseOptions().
 */
loadEnv({ path: join(__dirname, '..', '..', '.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}. Проверьте файл backend/.env`);
  }
  return value;
}

export default new DataSource({
  ...buildBaseOptions({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    username: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  }),
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
});
