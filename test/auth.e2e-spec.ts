import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, registerUser, resetData, TEST_PASSWORD } from './utils/test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  const validBody = {
    username: 'Alice_1',
    email: 'Alice@Example.com',
    password: TEST_PASSWORD,
  };

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
  });

  beforeEach(async () => {
    await resetData(ds);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('создаёт пользователя, статистику и настройки, возвращает токен', async () => {
      const res = await http().post('/auth/register').send(validBody).expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBe(3600);
      expect(res.body.user).toMatchObject({ username: 'Alice_1', email: 'alice@example.com' });
      expect(res.body.user.stats).toMatchObject({ xp: 0, level: 1, coins: 0 });
      expect(res.body.user.settings).toEqual({ allowPranks: true, timezone: 'UTC' });

      const [users, stats, settings] = await Promise.all([
        ds.query('SELECT count(*)::int AS n FROM users'),
        ds.query('SELECT count(*)::int AS n FROM user_stats'),
        ds.query('SELECT count(*)::int AS n FROM user_settings'),
      ]);
      expect([users[0].n, stats[0].n, settings[0].n]).toEqual([1, 1, 1]);
    });

    it('хранит пароль только в виде argon2id-хеша и не отдаёт его клиенту', async () => {
      const res = await http().post('/auth/register').send(validBody).expect(201);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('password_hash');
      expect(serialized).not.toContain(TEST_PASSWORD);

      const rows: Array<{ password_hash: string }> = await ds.query('SELECT password_hash FROM users');
      expect(rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    });

    it('обрезает пробелы вокруг username', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ ...validBody, username: '  alice_x  ' })
        .expect(201);
      expect(res.body.user.username).toBe('alice_x');
    });

    it('отклоняет повторный email без учёта регистра (EMAIL_TAKEN)', async () => {
      await http().post('/auth/register').send(validBody).expect(201);
      const res = await http()
        .post('/auth/register')
        .send({ ...validBody, username: 'other_name', email: 'ALICE@example.COM' })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
    });

    it('отклоняет повторный username без учёта регистра (USERNAME_TAKEN)', async () => {
      await http().post('/auth/register').send(validBody).expect(201);
      const res = await http()
        .post('/auth/register')
        .send({ ...validBody, username: 'ALICE_1', email: 'other@example.com' })
        .expect(409);
      expect(res.body.code).toBe('USERNAME_TAKEN');
    });

    it('неудачная регистрация не оставляет «осиротевших» строк', async () => {
      await http().post('/auth/register').send(validBody).expect(201);
      await http()
        .post('/auth/register')
        .send({ ...validBody, username: 'another_1' })
        .expect(409);

      const [users, stats, settings] = await Promise.all([
        ds.query('SELECT count(*)::int AS n FROM users'),
        ds.query('SELECT count(*)::int AS n FROM user_stats'),
        ds.query('SELECT count(*)::int AS n FROM user_settings'),
      ]);
      expect([users[0].n, stats[0].n, settings[0].n]).toEqual([1, 1, 1]);
    });

    it('при одновременных одинаковых регистрациях успешна ровно одна', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => http().post('/auth/register').send(validBody)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(['USERNAME_TAKEN', 'EMAIL_TAKEN']).toContain(r.body.code);
      }

      const rows: Array<{ n: number }> = await ds.query('SELECT count(*)::int AS n FROM users');
      expect(rows[0].n).toBe(1);
    });

    const invalidCases: Array<[string, Partial<typeof validBody>, string]> = [
      ['слишком короткий пароль', { password: 'short' }, 'password'],
      ['некорректный email', { email: 'not-an-email' }, 'email'],
      ['username с пробелом', { username: 'bad name' }, 'username'],
      ['слишком короткий username', { username: 'ab' }, 'username'],
      ['недопустимые символы в username', { username: 'алиса' }, 'username'],
    ];

    it.each(invalidCases)('валидация: %s → 400 VALIDATION_ERROR', async (_title, patch, field) => {
      const res = await http()
        .post('/auth/register')
        .send({ ...validBody, ...patch })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('запрещает лишние поля (защита от подстановки role, xp и т.п.)', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ ...validBody, role: 'admin', xp: 99999 })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await http().post('/auth/register').send(validBody).expect(201);
    });

    it('вход по email без учёта регистра', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ login: 'ALICE@example.com', password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.username).toBe('Alice_1');
    });

    it('вход по username без учёта регистра', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ login: 'alice_1', password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.user.email).toBe('alice@example.com');
    });

    it('неверный пароль → 401 INVALID_CREDENTIALS', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ login: 'alice_1', password: 'wrong-password' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('несуществующий пользователь даёт тот же ответ, что и неверный пароль', async () => {
      const wrongPassword = await http()
        .post('/auth/login')
        .send({ login: 'alice_1', password: 'wrong-password' })
        .expect(401);
      const unknownUser = await http()
        .post('/auth/login')
        .send({ login: 'nobody_here', password: 'wrong-password' })
        .expect(401);
      expect(unknownUser.body.code).toBe(wrongPassword.body.code);
      expect(unknownUser.body.message).toBe(wrongPassword.body.message);
    });

    it('пустое тело → 400 VALIDATION_ERROR', async () => {
      const res = await http().post('/auth/login').send({}).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /auth/me и защита приватных маршрутов', () => {
    it('без токена → 401 UNAUTHORIZED', async () => {
      const res = await http().get('/auth/me').expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('с мусорным токеном → 401', async () => {
      await http().get('/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('с токеном, подписанным другим секретом → 401', async () => {
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAiLCJ1c2VybmFtZSI6ImV2aWwifQ.' +
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      await http().get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('с валидным токеном возвращает профиль без чувствительных полей', async () => {
      const user = await registerUser(app);
      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: user.id, username: user.username, email: user.email });
      expect(res.body.stats).toMatchObject({ xp: 0, level: 1, coins: 0 });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('токен удалённого пользователя перестаёт работать', async () => {
      const user = await registerUser(app);
      await ds.query('DELETE FROM users WHERE id = $1', [user.id]);
      await http().get('/auth/me').set('Authorization', `Bearer ${user.token}`).expect(401);
    });
  });
});
