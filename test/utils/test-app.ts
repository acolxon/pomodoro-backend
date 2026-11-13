import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const TEST_PASSWORD = 'correct-horse-battery';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

/**
 * Поднимает приложение на тестовой БД: схема пересоздаётся с нуля
 * и строится ТОЛЬКО миграциями (заодно проверяются сами миграции).
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  // Реальный порт нужен, чтобы supertest безопасно выполнял параллельные запросы
  await app.listen(0);

  const dataSource = app.get(DataSource);
  const dbName = String(dataSource.options.database);
  if (!dbName.endsWith('_test')) {
    await app.close();
    throw new Error(`Отказ очищать базу "${dbName}": имя тестовой БД должно оканчиваться на _test`);
  }

  await dataSource.dropDatabase();
  await dataSource.runMigrations({ transaction: 'each' });
  return { app, dataSource };
}

export async function resetData(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
}

export interface RegisteredUser {
  id: string;
  token: string;
  username: string;
  email: string;
}

export async function registerUser(app: INestApplication, suffix = '1'): Promise<RegisteredUser> {
  const username = `user_${suffix}`;
  const email = `user_${suffix}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ username, email, password: TEST_PASSWORD })
    .expect(201);
  const body = res.body as { accessToken: string; user: { id: string } };
  return { id: body.user.id, token: body.accessToken, username, email };
}
