import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getPgErrorInfo } from '../src/common/utils/pg-error';
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
    const settings: unknown[] = await ds.query(`SELECT 1 FROM user_settings WHERE user_id = $1`, [
      id,
    ]);
    expect(stats).toHaveLength(0);
    expect(settings).toHaveLength(0);
  });

  it('создаёт таблицы и индексы Этапа 2 (Rooms)', async () => {
    expect(await tableNames()).toEqual(expect.arrayContaining(['rooms', 'room_members']));

    const rows: Array<{ indexname: string }> = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('rooms', 'room_members')`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        'uq_rooms_invite_code',
        'uq_room_members_active_user',
        'uq_room_members_active_owner',
      ]),
    );
  });

  describe('Ограничения Rooms на уровне PostgreSQL', () => {
    /** Проверяет, что БД отклонила операцию именно указанным ограничением. */
    async function expectConstraint(promise: Promise<unknown>, constraint: string): Promise<void> {
      const error = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).not.toBeNull();
      expect(getPgErrorInfo(error).constraint).toBe(constraint);
    }

    async function seedUsers(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 1; i <= count; i += 1) {
        const rows: Array<{ id: string }> = await ds.query(
          `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
          [`room_user_${i}`, `room_user_${i}@example.com`],
        );
        ids.push(rows[0].id);
      }
      return ids;
    }

    /** Комната + её владелец-участник создаются в одной транзакции (как делает сервис). */
    async function insertRoom(
      ownerId: string,
      inviteCode: string,
      maxMembers = 3,
    ): Promise<string> {
      return ds.transaction(async (manager) => {
        const rows: Array<{ id: string }> = await manager.query(
          `INSERT INTO rooms (owner_id, name, invite_code, max_members) VALUES ($1, 'room', $2, $3) RETURNING id`,
          [ownerId, inviteCode, maxMembers],
        );
        await manager.query(
          `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [rows[0].id, ownerId],
        );
        return rows[0].id;
      });
    }

    const addMember = (roomId: string, userId: string): Promise<unknown> =>
      ds.query(`INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`, [roomId, userId]);

    afterEach(async () => {
      await ds.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    });

    it('invite_code уникален и имеет фиксированный формат', async () => {
      const [a, b] = await seedUsers(2);
      await insertRoom(a, 'AAAAAAAA');

      await expectConstraint(insertRoom(b, 'AAAAAAAA'), 'uq_rooms_invite_code');
      await expectConstraint(insertRoom(b, 'abcdefgh'), 'ck_rooms_invite_code_format');
      await expectConstraint(insertRoom(b, 'AAAAAA0O'), 'ck_rooms_invite_code_format');
      await expectConstraint(insertRoom(b, 'SHORT'), 'ck_rooms_invite_code_format');
    });

    it('max_members и status ограничены CHECK', async () => {
      const [a] = await seedUsers(1);
      await expectConstraint(insertRoom(a, 'BBBBBBBB', 1), 'ck_rooms_max_members');
      await expectConstraint(insertRoom(a, 'BBBBBBBB', 51), 'ck_rooms_max_members');

      const roomId = await insertRoom(a, 'BBBBBBBB', 5);
      await expectConstraint(
        ds.query(`UPDATE rooms SET status = 'archived' WHERE id = $1`, [roomId]),
        'ck_rooms_status',
      );
    });

    it('пользователь не может быть активным участником двух комнат', async () => {
      const [a, b, c] = await seedUsers(3);
      const first = await insertRoom(a, 'CCCCCCCC');
      const second = await insertRoom(b, 'DDDDDDDD');
      await addMember(first, c);

      await expectConstraint(addMember(second, c), 'uq_room_members_active_user');
    });

    it('после выхода можно вступить снова: история участий сохраняется', async () => {
      const [a, b, c] = await seedUsers(3);
      const first = await insertRoom(a, 'EEEEEEEE');
      const second = await insertRoom(b, 'FFFFFFFF');

      await addMember(first, c);
      await ds.query(`UPDATE room_members SET left_at = clock_timestamp() WHERE user_id = $1`, [c]);
      await addMember(second, c); // другая комната
      await ds.query(
        `UPDATE room_members SET left_at = clock_timestamp() WHERE user_id = $1 AND left_at IS NULL`,
        [c],
      );
      await addMember(first, c); // повторно в ту же комнату

      const rows: Array<{ n: string }> = await ds.query(
        `SELECT count(*) AS n FROM room_members WHERE user_id = $1`,
        [c],
      );
      expect(Number(rows[0].n)).toBe(3);
      const active: Array<{ n: string }> = await ds.query(
        `SELECT count(*) AS n FROM room_members WHERE user_id = $1 AND left_at IS NULL`,
        [c],
      );
      expect(Number(active[0].n)).toBe(1);
    });

    it('в комнате не больше одного активного владельца', async () => {
      const [a, b] = await seedUsers(2);
      const roomId = await insertRoom(a, 'GGGGGGGG');
      await addMember(roomId, b);

      await expectConstraint(
        ds.query(`UPDATE room_members SET role = 'owner' WHERE user_id = $1`, [b]),
        'uq_room_members_active_owner',
      );
    });

    it('left_at не может быть раньше joined_at', async () => {
      const [a] = await seedUsers(1);
      await insertRoom(a, 'HHHHHHHH');
      await expectConstraint(
        ds.query(
          `UPDATE room_members SET left_at = joined_at - interval '1 second' WHERE user_id = $1`,
          [a],
        ),
        'ck_room_members_left_after_joined',
      );
    });

    it('вместимость: активных участников не больше max_members', async () => {
      const [a, b, c] = await seedUsers(3);
      const roomId = await insertRoom(a, 'JJJJJJJJ', 2);
      await addMember(roomId, b);

      await expectConstraint(addMember(roomId, c), 'ck_room_capacity');
    });

    it('владелец открытой комнаты обязан быть её активным участником-владельцем', async () => {
      const [a, b] = await seedUsers(2);

      // Комната без строки участника-владельца не фиксируется
      await expectConstraint(
        ds.query(
          `INSERT INTO rooms (owner_id, name, invite_code) VALUES ($1, 'room', 'KKKKKKKK')`,
          [a],
        ),
        'ck_room_owner_is_member',
      );

      // Подмена owner_id на пользователя, который не владелец-участник
      const roomId = await insertRoom(a, 'LLLLLLLL');
      await addMember(roomId, b);
      await expectConstraint(
        ds.query(`UPDATE rooms SET owner_id = $1 WHERE id = $2`, [b, roomId]),
        'ck_room_owner_is_member',
      );
    });

    it('в закрытой комнате не может быть активных участников', async () => {
      const [a] = await seedUsers(1);
      const roomId = await insertRoom(a, 'MMMMMMMM');
      await expectConstraint(
        ds.query(`UPDATE rooms SET status = 'closed' WHERE id = $1`, [roomId]),
        'ck_room_closed_empty',
      );

      // Если участник вышел в той же транзакции — закрытие допустимо
      await ds.transaction(async (manager) => {
        await manager.query(
          `UPDATE room_members SET left_at = clock_timestamp() WHERE room_id = $1`,
          [roomId],
        );
        await manager.query(`UPDATE rooms SET status = 'closed' WHERE id = $1`, [roomId]);
      });
    });

    it('гонка: две параллельные транзакции не могут занять последнее место', async () => {
      const [owner, b, c] = await seedUsers(3);
      const roomId = await insertRoom(owner, 'NNNNNNNN', 2); // осталось одно место

      const runnerB = ds.createQueryRunner();
      const runnerC = ds.createQueryRunner();
      try {
        await runnerB.startTransaction();
        await runnerC.startTransaction();
        // Обе транзакции вставляют участника ДО фиксации любой из них
        await runnerB.query(`INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`, [
          roomId,
          b,
        ]);
        await runnerC.query(`INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`, [
          roomId,
          c,
        ]);

        const results = await Promise.allSettled([
          runnerB.commitTransaction(),
          runnerC.commitTransaction(),
        ]);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(getPgErrorInfo(rejected[0].reason).constraint).toBe('ck_room_capacity');
      } finally {
        await runnerB.release();
        await runnerC.release();
      }

      const rows: Array<{ n: string }> = await ds.query(
        `SELECT count(*) AS n FROM room_members WHERE room_id = $1 AND left_at IS NULL`,
        [roomId],
      );
      expect(Number(rows[0].n)).toBe(2);
    });

    it('удаление владельца каскадно удаляет комнату и её участников', async () => {
      const [a, b] = await seedUsers(2);
      const roomId = await insertRoom(a, 'PPPPPPPP');
      await addMember(roomId, b);

      await ds.query(`DELETE FROM users WHERE id = $1`, [a]);

      const rooms: unknown[] = await ds.query(`SELECT 1 FROM rooms WHERE id = $1`, [roomId]);
      const members: unknown[] = await ds.query(`SELECT 1 FROM room_members WHERE room_id = $1`, [
        roomId,
      ]);
      expect(rooms).toHaveLength(0);
      expect(members).toHaveLength(0);
    });
  });

  it('миграции можно откатить и применить заново', async () => {
    // Последняя миграция — Rooms: после её отката остаются только таблицы Этапа 1
    await ds.undoLastMigration({ transaction: 'each' });
    const afterRooms = await tableNames();
    expect(afterRooms).not.toContain('rooms');
    expect(afterRooms).not.toContain('room_members');
    expect(afterRooms).toContain('users');

    await ds.undoLastMigration({ transaction: 'each' });
    expect(await tableNames()).not.toContain('users');

    await ds.runMigrations({ transaction: 'each' });
    expect(await tableNames()).toEqual(
      expect.arrayContaining(['users', 'user_stats', 'user_settings', 'rooms', 'room_members']),
    );
  });
});
