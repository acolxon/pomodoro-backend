import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, registerUser, resetData } from './utils/test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
  });

  beforeEach(async () => {
    await resetData(ds);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /users/me требует авторизации', async () => {
    await http().get('/users/me').expect(401);
  });

  it('GET /users/me возвращает полный профиль', async () => {
    const user = await registerUser(app);
    const res = await http().get('/users/me').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(res.body).toMatchObject({ id: user.id, email: user.email });
    expect(res.body.settings).toEqual({ allowPranks: true, timezone: 'UTC' });
  });

  describe('GET /users/:id (публичный профиль)', () => {
    it('не раскрывает email, Coins и настройки', async () => {
      const alice = await registerUser(app, 'a');
      const bob = await registerUser(app, 'b');

      const res = await http()
        .get(`/users/${bob.id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200);

      expect(res.body).toEqual({
        id: bob.id,
        username: bob.username,
        avatarUrl: null,
        level: 1,
        xp: 0,
        createdAt: expect.any(String),
      });
    });

    it('требует авторизации', async () => {
      const user = await registerUser(app);
      await http().get(`/users/${user.id}`).expect(401);
    });

    it('некорректный UUID → 400 VALIDATION_ERROR', async () => {
      const user = await registerUser(app);
      const res = await http()
        .get('/users/not-a-uuid')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('несуществующий пользователь → 404 USER_NOT_FOUND', async () => {
      const user = await registerUser(app);
      const res = await http()
        .get('/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
      expect(res.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('PATCH /users/me/settings', () => {
    it('обновляет allowPranks и timezone', async () => {
      const user = await registerUser(app);
      const res = await http()
        .patch('/users/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ allowPranks: false, timezone: 'Asia/Almaty' })
        .expect(200);
      expect(res.body.settings).toEqual({ allowPranks: false, timezone: 'Asia/Almaty' });

      const rows: Array<{ allow_pranks: boolean; timezone: string }> = await ds.query(
        'SELECT allow_pranks, timezone FROM user_settings WHERE user_id = $1',
        [user.id],
      );
      expect(rows[0]).toEqual({ allow_pranks: false, timezone: 'Asia/Almaty' });
    });

    it('частичное обновление не затрагивает остальные поля', async () => {
      const user = await registerUser(app);
      const res = await http()
        .patch('/users/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ allowPranks: false })
        .expect(200);
      expect(res.body.settings).toEqual({ allowPranks: false, timezone: 'UTC' });
    });

    it('некорректный часовой пояс → 400', async () => {
      const user = await registerUser(app);
      const res = await http()
        .patch('/users/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ timezone: 'Mars/Olympus' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('пустое тело → 400', async () => {
      const user = await registerUser(app);
      await http()
        .patch('/users/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({})
        .expect(400);
    });

    it('клиент не может менять XP, уровень и Coins через настройки', async () => {
      const user = await registerUser(app);
      const res = await http()
        .patch('/users/me/settings')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ allowPranks: true, xp: 99999, coins: 99999 })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      const rows: Array<{ xp: number; coins: number }> = await ds.query(
        'SELECT xp, coins FROM user_stats WHERE user_id = $1',
        [user.id],
      );
      expect(rows[0]).toEqual({ xp: 0, coins: 0 });
    });
  });
});
