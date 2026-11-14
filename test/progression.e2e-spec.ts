import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { HistoryService } from '../src/history/history.service';
import { PomodoroService } from '../src/pomodoro/pomodoro.service';
import { ProgressionService } from '../src/progression/progression.service';
import { PomodoroRun } from '../src/history/entities/pomodoro-run.entity';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';

describe('Focus rewards and levels (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let timer: PomodoroService;
  let clock: jest.SpyInstance | undefined;
  let instant: number;
  const http = () => request(app.getHttpServer());
  const as = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
    timer = app.get(PomodoroService);
  });
  beforeEach(async () => {
    await resetData(ds);
    instant = Date.now();
    clock = jest.spyOn(Date, 'now').mockImplementation(() => instant);
  });
  afterEach(() => {
    clock?.mockRestore();
    timer.onModuleDestroy();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  async function roomFor(owner: RegisteredUser) {
    return (await http().post('/rooms').set(as(owner)).send({ name: 'Reward garden' }).expect(201))
      .body as { id: string; inviteCode: string };
  }
  async function join(user: RegisteredUser, code: string) {
    await http().post('/rooms/join').set(as(user)).send({ inviteCode: code }).expect(200);
  }
  async function profile(user: RegisteredUser) {
    return (await http().get('/auth/me').set(as(user)).expect(200)).body;
  }
  async function complete(owner: RegisteredUser, roomId: string) {
    const started = await timer.start(owner.id, roomId);
    instant += 1_500_001;
    await Promise.all([timer.getState(owner.id, roomId), timer.getState(owner.id, roomId)]);
    return started.pomodoroSessionId!;
  }

  it('awards once under concurrent finalization and direct retry, then levels up after four solo Focus', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    const runId = await complete(user, room.id);
    const progression = app.get(ProgressionService);
    const retry = () =>
      ds.transaction(async (manager) => {
        const run = await manager.findOneOrFail(PomodoroRun, {
          where: { id: runId },
          lock: { mode: 'pessimistic_write' },
        });
        await progression.awardFocus(manager, run);
      });
    await Promise.all([retry(), retry()]);
    expect((await profile(user)).stats).toMatchObject({
      xp: 25,
      coins: 10,
      level: 1,
      sessionsCompleted: 1,
      activeDays: 1,
    });
    expect(
      await ds.query('SELECT id FROM economy_transactions WHERE source_id = $1', [runId]),
    ).toHaveLength(1);
    const history = (await http().get('/history').set(as(user)).expect(200)).body;
    expect(history.items[0]).toMatchObject({ xpEarned: 25, coinsEarned: 10, teamBonus: false });
    for (let index = 0; index < 3; index++) {
      await timer.cancel(user.id, room.id); // end Break, never removes earned progress
      await complete(user, room.id);
    }
    const final = await profile(user);
    expect(final.stats).toMatchObject({ xp: 100, coins: 40, level: 2, sessionsCompleted: 4 });
    expect(final.progression).toMatchObject({
      level: 2,
      xpInLevel: 0,
      nextLevelXp: 300,
      xpToNextLevel: 200,
    });
  });

  it('awards the team bonus only when every starter finishes; late arrivals get nothing', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const late = await registerUser(app, 'late');
    const room = await roomFor(owner);
    await join(member, room.inviteCode);
    const started = await timer.start(owner.id, room.id);
    await join(late, room.inviteCode);
    instant += 1_500_001;
    await timer.getState(owner.id, room.id);
    for (const user of [owner, member]) {
      expect((await profile(user)).stats).toMatchObject({
        xp: 30,
        coins: 12,
        sessionsCompleted: 1,
        collabSessionsCompleted: 1,
      });
    }
    expect((await profile(late)).stats).toMatchObject({ xp: 0, coins: 0, sessionsCompleted: 0 });
    const receipts = await ds.query(
      'SELECT xp, coins, team_bonus FROM economy_transactions WHERE source_id = $1',
      [started.pomodoroSessionId],
    );
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt: { team_bonus: boolean }) => receipt.team_bonus)).toBe(true);
  });

  it('does not reward a departed or rejoined participant or award team bonus to the remaining finisher', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const room = await roomFor(owner);
    await join(member, room.inviteCode);
    await timer.start(owner.id, room.id);
    instant += 60_000;
    await http().post('/rooms/leave').set(as(member)).expect(200);
    await join(member, room.inviteCode);
    instant += 1_440_001;
    await timer.getState(owner.id, room.id);
    expect((await profile(owner)).stats).toMatchObject({
      xp: 25,
      coins: 10,
      collabSessionsCompleted: 0,
    });
    expect((await profile(member)).stats).toMatchObject({ xp: 0, coins: 0 });
  });

  it('gives no reward for manual cancellation or pause expiry', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    await timer.start(user.id, room.id);
    instant += 60_000;
    await timer.cancel(user.id, room.id);
    await timer.start(user.id, room.id);
    instant += 60_000;
    await timer.pause(user.id, room.id);
    instant += 86_400_001;
    await timer.getState(user.id, room.id);
    expect((await profile(user)).stats).toMatchObject({ xp: 0, coins: 0, sessionsCompleted: 0 });
    expect(await ds.query('SELECT id FROM economy_transactions')).toHaveLength(0);
  });

  it('preserves a full reward if the last member leaves after the deadline before scheduler recovery', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    const started = await timer.start(user.id, room.id);
    const past = new Date(instant - 1_501_000);
    await ds.query('UPDATE pomodoro_runs SET started_at = $1 WHERE id = $2', [
      past,
      started.pomodoroSessionId,
    ]);
    await ds.query(
      'UPDATE pomodoro_sessions SET started_at = $1, ends_at = $2 WHERE room_id = $3',
      [past, new Date(past.getTime() + 1_500_000), room.id],
    );
    await http().post('/rooms/leave').set(as(user)).expect(200);
    expect((await profile(user)).stats).toMatchObject({ xp: 25, coins: 10, sessionsCompleted: 1 });
    expect((await http().get('/history').set(as(user)).expect(200)).body.items[0]).toMatchObject({
      status: 'completed',
      xpEarned: 25,
    });
  });

  it('rolls back awards, stats, history and timer together on a downstream failure', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    await timer.start(user.id, room.id);
    instant += 1_500_001;
    const history = app.get(HistoryService);
    const finish = history.finishFocus.bind(history);
    const fail = jest.spyOn(history, 'finishFocus').mockImplementationOnce(async (...args) => {
      await finish(...args);
      throw new Error('failure after rewards');
    });
    await expect(timer.getState(user.id, room.id)).rejects.toThrow('failure after rewards');
    fail.mockRestore();
    expect((await profile(user)).stats).toMatchObject({ xp: 0, coins: 0, sessionsCompleted: 0 });
    expect(await ds.query('SELECT id FROM economy_transactions')).toHaveLength(0);
    expect((await http().get('/history').set(as(user)).expect(200)).body.total).toBe(0);
    await timer.getState(user.id, room.id);
    expect((await profile(user)).stats.xp).toBe(25);
  });

  it('never exposes a client command for minting XP and rejects duplicate receipts at DB level', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    const runId = await complete(user, room.id);
    await http()
      .post('/progression/reward')
      .set(as(user))
      .send({ xp: 999999, coins: 999999 })
      .expect(404);
    await expect(
      ds.query(
        `INSERT INTO economy_transactions (user_id, source_type, source_id, xp, coins, team_bonus, activity_date, earned_at)
      SELECT user_id, source_type, source_id, xp, coins, team_bonus, activity_date, earned_at
      FROM economy_transactions WHERE source_id = $1`,
        [runId],
      ),
    ).rejects.toThrow(/uq_economy_source_user/);
    expect((await profile(user)).stats).toMatchObject({ xp: 25, coins: 10 });
  });

  it('reverts and reapplies the rewards migration while preserving existing balances and history', async () => {
    const user = await registerUser(app);
    const room = await roomFor(user);
    await timer.start(user.id, room.id);
    instant += 60_000;
    await timer.cancel(user.id, room.id);
    await ds.undoLastMigration({ transaction: 'all' });
    try {
      const [row] = await ds.query(
        `SELECT to_regclass('economy_transactions') AS ledger, (SELECT count(*)::int FROM focus_history) AS history`,
      );
      expect(row).toEqual({ ledger: null, history: 1 });
    } finally {
      await ds.runMigrations({ transaction: 'each' });
    }
    expect((await profile(user)).stats.xp).toBe(0);
    expect((await http().get('/history').set(as(user)).expect(200)).body.items[0]).toMatchObject({
      xpEarned: 0,
      coinsEarned: 0,
    });
  });
});
