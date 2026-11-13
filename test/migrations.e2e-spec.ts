import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/test-app';

describe('Миграции и ограничения БД (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function tableNames(): Promise<string[]> {
    const rows: Array<{ tablename: string }> = await ds.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    return rows.map((r) => r.tablename);
  }

  it('создаёт таблицы Этапа 1', async () => {
    expect(await tableNames()).toEqual(
      expect.arrayContaining(['users', 'user_stats', 'user_settings', 'migrations']),
    );
  });

  it('создаёт уникальные индексы без учёта регистра', async () => {
    const rows: Array<{ indexname: string }> = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(['uq_users_username_lower', 'uq_users_email_lower']),
    );
  });

  it('БД не даёт Coins уйти в минус (CHECK coins >= 0)', async () => {
    await ds.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('db_check', 'db_check@example.com', 'x')`,
    );
    const [{ id }]: Array<{ id: string }> = await ds.query(
      `SELECT id FROM users WHERE username = 'db_check'`,
    );
    await ds.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
    await expect(
      ds.query(`UPDATE user_stats SET coins = -1 WHERE user_id = $1`, [id]),
    ).rejects.toThrow(/ck_user_stats_coins/);
    await ds.query(`DELETE FROM users WHERE id = $1`, [id]);
  });

  it('удаление пользователя каскадно удаляет статистику и настройки', async () => {
    await ds.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('cascade_u', 'cascade@example.com', 'x')`,
    );
    const [{ id }]: Array<{ id: string }> = await ds.query(
      `SELECT id FROM users WHERE username = 'cascade_u'`,
    );
    await ds.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
    await ds.query(`INSERT INTO user_settings (user_id) VALUES ($1)`, [id]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [id]);

    const stats: unknown[] = await ds.query(`SELECT 1 FROM user_stats WHERE user_id = $1`, [id]);
    const settings: unknown[] = await ds.query(`SELECT 1 FROM user_settings WHERE user_id = $1`, [id]);
    expect(stats).toHaveLength(0);
    expect(settings).toHaveLength(0);
  });

  it('миграцию можно откатить и применить заново', async () => {
    await ds.undoLastMigration({ transaction: 'each' });
    expect(await tableNames()).not.toContain('users');

    await ds.runMigrations({ transaction: 'each' });
    expect(await tableNames()).toEqual(expect.arrayContaining(['users', 'user_stats', 'user_settings']));
  });
});
