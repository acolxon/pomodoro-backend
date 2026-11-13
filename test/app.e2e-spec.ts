import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

describe('Health и общий формат ошибок (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health публичный и подтверждает подключение к БД', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('неизвестный маршрут возвращает ошибку в едином формате', async () => {
    const res = await request(app.getHttpServer()).get('/no-such-route').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', path: '/no-such-route' });
    expect(res.body.timestamp).toEqual(expect.any(String));
  });
});
