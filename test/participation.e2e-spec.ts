import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PomodoroService } from '../src/pomodoro/pomodoro.service';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';

describe('Session readiness and personal departure (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let timer: PomodoroService;
  let clock: jest.SpyInstance;
  let now: number;
  const http = () => request(app.getHttpServer());
  const auth = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });
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
  async function task(user: RegisteredUser, title: string) {
    const created = await http().post('/tasks').set(auth(user)).send({ title }).expect(201);
    await http()
      .patch(`/tasks/${created.body.id}`)
      .set(auth(user))
      .send({ status: 'in_progress' })
      .expect(200);
    return created.body.id as string;
  }

  it('requires all participants to be ready with a task; one may leave while the others finish and receive rewards', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const late = await registerUser(app, 'late');
    const room = (
      await http().post('/rooms').set(auth(owner)).send({ name: 'Session' }).expect(201)
    ).body;
    await http()
      .post('/rooms/join')
      .set(auth(member))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    await expect(timer.start(owner.id, room.id)).rejects.toThrow(/готовность/);
    await expect(timer.setReady(owner.id, room.id, true)).rejects.toThrow(/задачу/);
    await task(owner, 'Owner task');
    await task(member, 'Member task');
    await timer.setReady(owner.id, room.id, true);
    await expect(timer.start(owner.id, room.id)).rejects.toThrow(/готовность/);
    await timer.setReady(member.id, room.id, true);
    const started = await timer.start(owner.id, room.id);
    const runId = started.pomodoroSessionId!;
    const members = (await http().get(`/rooms/${room.id}/members`).set(auth(owner)).expect(200))
      .body;
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member.id,
          sessionStatus: 'focusing',
          taskTitle: 'Member task',
        }),
      ]),
    );
    await http()
      .post('/rooms/join')
      .set(auth(late))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    await expect(timer.setReady(late.id, room.id, true)).rejects.toThrow();
    await expect(timer.leaveFocus(late.id, room.id)).rejects.toThrow();
    now += 300_000;
    await timer.leaveFocus(member.id, room.id);
    await expect(timer.leaveFocus(member.id, room.id)).rejects.toThrow();
    expect((await http().get('/rooms/me').set(auth(member)).expect(200)).body.id).toBe(room.id);
    expect((await timer.getState(owner.id, room.id)).status).toBe('running');
    expect(
      (await http().get(`/rooms/${room.id}/members`).set(auth(owner)).expect(200)).body,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: member.id, sessionStatus: 'left_early' }),
        expect.objectContaining({ userId: late.id, sessionStatus: 'observer' }),
      ]),
    );
    now += 1_200_001;
    await Promise.all([timer.getState(owner.id, room.id), timer.getState(owner.id, room.id)]);
    const result = (
      await http().get(`/history/sessions/${runId}/results`).set(auth(member)).expect(200)
    ).body;
    expect(result.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: owner.id,
          status: 'completed',
          focusedSeconds: 1500,
          xpEarned: 25,
          coinsEarned: 10,
        }),
        expect.objectContaining({
          userId: member.id,
          status: 'cancelled',
          focusedSeconds: 300,
          finishReason: 'left_focus',
          xpEarned: 0,
          coinsEarned: 0,
        }),
      ]),
    );
    await http().get(`/history/sessions/${runId}/results`).set(auth(late)).expect(404);
    expect((await http().get('/auth/me').set(auth(member)).expect(200)).body.stats.xp).toBe(0);
    expect((await http().get('/auth/me').set(auth(owner)).expect(200)).body.stats.xp).toBe(25);
    expect(
      await ds.query('SELECT id FROM economy_transactions WHERE source_id = $1', [runId]),
    ).toHaveLength(1);
  });

  it('clears readiness when the selected task is completed or deleted', async () => {
    const owner = await registerUser(app);
    const room = (await http().post('/rooms').set(auth(owner)).send({ name: 'Ready' }).expect(201))
      .body;
    const id = await task(owner, 'Task');
    await timer.setReady(owner.id, room.id, true);
    await http().patch(`/tasks/${id}`).set(auth(owner)).send({ status: 'completed' }).expect(200);
    expect(
      (await http().get(`/rooms/${room.id}/members`).set(auth(owner)).expect(200)).body[0].ready,
    ).toBe(false);
    await expect(timer.start(owner.id, room.id)).rejects.toThrow(/готовность/);
    const next = await task(owner, 'Next');
    await timer.setReady(owner.id, room.id, true);
    await http().delete(`/tasks/${next}`).set(auth(owner)).expect(204);
    expect(
      (await http().get(`/rooms/${room.id}/members`).set(auth(owner)).expect(200)).body[0].ready,
    ).toBe(false);
  });
});
