import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PomodoroService } from '../src/pomodoro/pomodoro.service';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';
import { readyRoom } from './utils/ready-room';

describe('XP booster shop (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let timer: PomodoroService;
  let clock: jest.SpyInstance;
  let now: number;
  const http = () => request(app.getHttpServer());
  const as = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });
  const buy = (user: RegisteredUser, requestId: string) =>
    http().post('/shop/xp-booster').set(as(user)).send({ requestId });
  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
    timer = app.get(PomodoroService);
  });
  beforeEach(async () => {
    await resetData(ds);
    now = Date.now();
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    clock.mockRestore();
    timer.onModuleDestroy();
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  async function createRoom(user: RegisteredUser) {
    return (await http().post('/rooms').set(as(user)).send({ name: 'Garden' }).expect(201)).body;
  }

  it('serializes purchases, prevents overdraft, isolates users and treats retries idempotently', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await ds.query('UPDATE user_stats SET coins = 20 WHERE user_id = $1', [alice.id]);
    const firstId = randomUUID();
    const [first, retry] = await Promise.all([buy(alice, firstId), buy(alice, firstId)]);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(first.body).toMatchObject({
      coins: 0,
      item: { quantity: 1, price: 20, bonusPercent: 10 },
    });
    expect(retry.body).toMatchObject({ coins: 0, item: { quantity: 1 } });
    await buy(alice, randomUUID()).expect(409);
    expect((await http().get('/shop').set(as(bob)).expect(200)).body).toMatchObject({
      coins: 0,
      item: { quantity: 0 },
    });
    await http().get('/shop').expect(401);
    await http()
      .post('/shop/xp-booster')
      .set(as(alice))
      .send({ requestId: 'bad', price: 0 })
      .expect(400);
    expect(
      await ds.query('SELECT * FROM shop_purchases WHERE user_id = $1', [alice.id]),
    ).toHaveLength(1);
    expect((await http().get('/auth/me').set(as(alice)).expect(200)).body.stats.coins).toBe(0);
  });

  it('prevents simultaneous different purchases from spending the same coins', async () => {
    const user = await registerUser(app);
    await ds.query('UPDATE user_stats SET coins = 20 WHERE user_id = $1', [user.id]);
    const responses = await Promise.all([buy(user, randomUUID()), buy(user, randomUUID())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await http().get('/shop').set(as(user)).expect(200)).body).toMatchObject({
      coins: 0,
      item: { quantity: 1 },
    });
  });

  it('keeps a charge through cancellation and consumes it once on the next completed focus', async () => {
    const user = await registerUser(app);
    const room = await createRoom(user);
    await ds.query('UPDATE user_stats SET coins = 20 WHERE user_id = $1', [user.id]);
    await buy(user, randomUUID()).expect(200);
    await readyRoom(ds, timer, room.id);
    await timer.start(user.id, room.id);
    now += 60_000;
    await timer.cancel(user.id, room.id);
    expect((await http().get('/shop').set(as(user)).expect(200)).body.item.quantity).toBe(1);
    await readyRoom(ds, timer, room.id);
    const started = await timer.start(user.id, room.id);
    now += 1_500_001;
    await Promise.all([timer.getState(user.id, room.id), timer.getState(user.id, room.id)]);
    const shop = (await http().get('/shop').set(as(user)).expect(200)).body;
    expect(shop).toMatchObject({ coins: 10, item: { quantity: 0 } });
    const profile = (await http().get('/auth/me').set(as(user)).expect(200)).body;
    expect(profile.stats).toMatchObject({ xp: 27, coins: 10, sessionsCompleted: 1 });
    const history = (await http().get('/history').set(as(user)).expect(200)).body.items;
    expect(
      history.find(
        (row: { pomodoroSessionId: string }) => row.pomodoroSessionId === started.pomodoroSessionId,
      ),
    ).toMatchObject({ xpEarned: 27, coinsEarned: 10 });
    expect(
      await ds.query('SELECT * FROM economy_transactions WHERE source_id = $1', [
        started.pomodoroSessionId,
      ]),
    ).toHaveLength(1);
  });

  it('rolls back a purchase on a write failure', async () => {
    const user = await registerUser(app);
    await ds.query('UPDATE user_stats SET coins = 20 WHERE user_id = $1', [user.id]);
    await ds.query(
      `CREATE FUNCTION reject_test_booster() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END; $$ LANGUAGE plpgsql`,
    );
    await ds.query(
      'CREATE TRIGGER reject_test_booster BEFORE INSERT ON xp_booster_inventory FOR EACH ROW EXECUTE FUNCTION reject_test_booster()',
    );
    try {
      await buy(user, randomUUID()).expect(500);
      expect((await http().get('/auth/me').set(as(user)).expect(200)).body.stats.coins).toBe(20);
      expect(
        await ds.query('SELECT request_id FROM shop_purchases WHERE user_id = $1', [user.id]),
      ).toHaveLength(0);
    } finally {
      await ds.query('DROP TRIGGER reject_test_booster ON xp_booster_inventory');
      await ds.query('DROP FUNCTION reject_test_booster()');
    }
  });

  it('preserves a booster when a participant leaves early and others complete the focus', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const room = await createRoom(owner);
    await http()
      .post('/rooms/join')
      .set(as(member))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    await ds.query('UPDATE user_stats SET coins = 20 WHERE user_id = $1', [member.id]);
    await buy(member, randomUUID()).expect(200);
    await readyRoom(ds, timer, room.id);
    await timer.start(owner.id, room.id);
    now += 300_000;
    await timer.leaveFocus(member.id, room.id);
    now += 1_200_001;
    await timer.getState(owner.id, room.id);
    expect((await http().get('/shop').set(as(member)).expect(200)).body.item.quantity).toBe(1);
    expect((await http().get('/auth/me').set(as(member)).expect(200)).body.stats.xp).toBe(0);
    expect((await http().get('/auth/me').set(as(owner)).expect(200)).body.stats.xp).toBe(25);
  });
});
