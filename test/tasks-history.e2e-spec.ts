import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { HistoryService } from '../src/history/history.service';
import { PomodoroService } from '../src/pomodoro/pomodoro.service';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';

describe('Tasks, persisted Pomodoro runs and History (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let pomodoro: PomodoroService;
  let clock: jest.SpyInstance | undefined;
  const http = () => request(app.getHttpServer());
  const as = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
    pomodoro = app.get(PomodoroService);
  });
  beforeEach(async () => {
    await resetData(ds);
  });
  afterEach(() => {
    clock?.mockRestore();
    clock = undefined;
    pomodoro.onModuleDestroy();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  async function roomFor(owner: RegisteredUser) {
    const response = await http().post('/rooms').set(as(owner)).send({ name: 'Study' }).expect(201);
    return response.body as { id: string; inviteCode: string };
  }
  async function taskFor(user: RegisteredUser, title: string) {
    const response = await http().post('/tasks').set(as(user)).send({ title }).expect(201);
    await http()
      .patch(`/tasks/${response.body.id}`)
      .set(as(user))
      .send({ status: 'in_progress' })
      .expect(200);
    return response.body as { id: string; title: string };
  }
  function controlTime() {
    const start = Date.now();
    clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    return { start, at: (milliseconds: number) => clock!.mockReturnValue(start + milliseconds) };
  }

  it('validates, isolates and updates personal tasks without changing the original completion time', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await http().post('/tasks').set(as(alice)).send({ title: '  ' }).expect(400);
    const task = await http()
      .post('/tasks')
      .set(as(alice))
      .send({ title: '  Read  ', description: ' notes ' })
      .expect(201);
    expect(task.body).toMatchObject({
      title: 'Read',
      description: 'notes',
      status: 'todo',
      completedAt: null,
    });
    await http().get(`/tasks/${task.body.id}`).set(as(bob)).expect(404);
    await http()
      .patch(`/tasks/${task.body.id}`)
      .set(as(bob))
      .send({ status: 'completed' })
      .expect(404);
    await http().delete(`/tasks/${task.body.id}`).set(as(bob)).expect(404);
    await http().patch(`/tasks/${task.body.id}`).set(as(alice)).send({ status: null }).expect(400);
    await http().patch(`/tasks/${task.body.id}`).set(as(alice)).send({ title: null }).expect(400);
    const completed = await http()
      .patch(`/tasks/${task.body.id}`)
      .set(as(alice))
      .send({ status: 'completed' })
      .expect(200);
    const repeated = await http()
      .patch(`/tasks/${task.body.id}`)
      .set(as(alice))
      .send({ status: 'completed', description: ' ' })
      .expect(200);
    expect(repeated.body).toMatchObject({
      completedAt: completed.body.completedAt,
      description: null,
    });
    const listed = await http().get('/tasks?status=completed').set(as(alice)).expect(200);
    expect(listed.body).toHaveLength(1);
    await http().delete(`/tasks/${task.body.id}`).set(as(alice)).expect(204);
    await http().get(`/tasks/${task.body.id}`).set(as(alice)).expect(404);
  });

  it('allows only one active task even for concurrent updates', async () => {
    const user = await registerUser(app);
    const first = await http().post('/tasks').set(as(user)).send({ title: 'First' }).expect(201);
    const second = await http().post('/tasks').set(as(user)).send({ title: 'Second' }).expect(201);
    const responses = await Promise.all(
      [first, second].map((task) =>
        http().patch(`/tasks/${task.body.id}`).set(as(user)).send({ status: 'in_progress' }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe(
      'ACTIVE_TASK_EXISTS',
    );
    const active = await http().get('/tasks?status=in_progress').set(as(user)).expect(200);
    expect(active.body).toHaveLength(1);
  });

  it('snapshots each participant task and completes a shared run exactly once', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const stranger = await registerUser(app, 'stranger');
    const room = await roomFor(owner);
    await http()
      .post('/rooms/join')
      .set(as(member))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    const ownerTask = await taskFor(owner, 'Original title');
    const memberTask = await taskFor(member, 'Member task');
    const time = controlTime();
    const running = await pomodoro.start(owner.id, room.id);
    expect(running.pomodoroSessionId).toEqual(expect.any(String));
    const repeatedStart = await pomodoro.start(owner.id, room.id);
    expect(repeatedStart.pomodoroSessionId).toBe(running.pomodoroSessionId);
    await http()
      .patch(`/tasks/${ownerTask.id}`)
      .set(as(owner))
      .send({ title: 'Renamed' })
      .expect(200);
    await http().delete(`/tasks/${memberTask.id}`).set(as(member)).expect(204);
    time.at(1_500_001);
    const states = await Promise.all([
      pomodoro.getState(owner.id, room.id),
      pomodoro.getState(member.id, room.id),
    ]);
    expect(states.every((state) => state.phase === 'break')).toBe(true);
    const ownerHistory = await http().get('/history').set(as(owner)).expect(200);
    const memberHistory = await http().get('/history').set(as(member)).expect(200);
    expect(ownerHistory.body.total).toBe(1);
    expect(memberHistory.body.total).toBe(1);
    expect(ownerHistory.body.items[0]).toMatchObject({
      taskId: ownerTask.id,
      taskTitle: 'Original title',
      focusedSeconds: 1500,
      status: 'completed',
      pomodoroSessionId: running.pomodoroSessionId,
    });
    expect(memberHistory.body.items[0]).toMatchObject({
      taskId: null,
      taskTitle: 'Member task',
      focusedSeconds: 1500,
      status: 'completed',
      pomodoroSessionId: running.pomodoroSessionId,
    });
    await http().get(`/history/${ownerHistory.body.items[0].id}`).set(as(stranger)).expect(404);
    expect((await http().get('/history').set(as(stranger)).expect(200)).body.total).toBe(0);
    const stats = await http().get('/history/stats').set(as(owner)).expect(200);
    expect(stats.body).toMatchObject({
      totalSessions: 1,
      completedSessions: 1,
      cancelledSessions: 0,
      totalFocusedSeconds: 1500,
      totalFocusedMinutes: 25,
    });
    await pomodoro.cancel(owner.id, room.id); // cancelling Break must preserve the completed Focus
    expect((await http().get('/history').set(as(owner)).expect(200)).body.total).toBe(1);
  });

  it('keeps precise Focus time across pauses and resumes from persisted state', async () => {
    const owner = await registerUser(app);
    const room = await roomFor(owner);
    const time = controlTime();
    const first = await pomodoro.start(owner.id, room.id);
    time.at(62_500);
    await pomodoro.pause(owner.id, room.id);
    pomodoro.onModuleDestroy();
    const recovered = new PomodoroService(ds, app.get(HistoryService));
    try {
      await recovered.onModuleInit();
      time.at(662_500);
      const resumed = await recovered.resume(owner.id, room.id);
      expect(resumed.pomodoroSessionId).toBe(first.pomodoroSessionId);
      expect(resumed.endsAt?.getTime()).toBe(time.start + 2_100_000);
      time.at(692_500);
      await recovered.cancel(owner.id, room.id);
      await recovered.cancel(owner.id, room.id);
      const history = await http().get('/history').set(as(owner)).expect(200);
      expect(history.body.total).toBe(1);
      expect(history.body.items[0]).toMatchObject({
        status: 'cancelled',
        focusedSeconds: 92,
        pomodoroSessionId: first.pomodoroSessionId,
      });
    } finally {
      recovered.onModuleDestroy();
    }
  });

  it('excludes long pauses when a Focus is cancelled while paused', async () => {
    const owner = await registerUser(app);
    const room = await roomFor(owner);
    const time = controlTime();
    await pomodoro.start(owner.id, room.id);
    time.at(35_000);
    await pomodoro.pause(owner.id, room.id);
    time.at(635_000);
    await pomodoro.cancel(owner.id, room.id);
    const history = await http().get('/history').set(as(owner)).expect(200);
    expect(history.body.items[0]).toMatchObject({ status: 'cancelled', focusedSeconds: 35 });
  });

  it('records departure immediately and does not enroll a returning member twice', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const room = await roomFor(owner);
    await http()
      .post('/rooms/join')
      .set(as(member))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    const run = await pomodoro.start(owner.id, room.id);
    const startedAt = new Date(Date.now() - 15_000);
    // Backdate the fixture instead of waiting 15 seconds; membership still brackets the whole run.
    await ds.query('UPDATE room_members SET joined_at = $1 WHERE room_id = $2 AND user_id = $3', [
      new Date(startedAt.getTime() - 1000),
      room.id,
      member.id,
    ]);
    await ds.query('UPDATE pomodoro_runs SET started_at = $1 WHERE id = $2', [
      startedAt,
      run.pomodoroSessionId,
    ]);
    await ds.query(
      'UPDATE pomodoro_sessions SET started_at = $1, ends_at = $2 WHERE room_id = $3',
      [startedAt, new Date(startedAt.getTime() + 1_500_000), room.id],
    );
    await http().post('/rooms/leave').set(as(member)).expect(200);
    const before = await http().get('/history').set(as(member)).expect(200);
    expect(before.body.total).toBe(1);
    expect(before.body.items[0].status).toBe('cancelled');
    expect(before.body.items[0].focusedSeconds).toBeGreaterThanOrEqual(15);
    expect(before.body.items[0].focusedSeconds).toBeLessThan(17);
    await http()
      .post('/rooms/join')
      .set(as(member))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    await pomodoro.cancel(owner.id, room.id);
    const after = await http().get('/history').set(as(member)).expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('enrolls late arrivals in the next Focus and closes a paused timer when the room empties', async () => {
    const owner = await registerUser(app, 'owner');
    const late = await registerUser(app, 'late');
    const room = await roomFor(owner);
    await pomodoro.start(owner.id, room.id);
    await http()
      .post('/rooms/join')
      .set(as(late))
      .send({ inviteCode: room.inviteCode })
      .expect(200);
    await pomodoro.cancel(owner.id, room.id);
    expect((await http().get('/history').set(as(late)).expect(200)).body.total).toBe(0);
    await http().post('/rooms/leave').set(as(late)).expect(200);
    const second = await pomodoro.start(owner.id, room.id);
    await pomodoro.pause(owner.id, room.id);
    await http().post('/rooms/leave').set(as(owner)).expect(200);
    const [run] = await ds.query('SELECT status FROM pomodoro_runs WHERE id = $1', [
      second.pomodoroSessionId,
    ]);
    const [timer] = await ds.query(
      'SELECT status, focus_run_id FROM pomodoro_sessions WHERE room_id = $1',
      [room.id],
    );
    expect(run.status).toBe('cancelled');
    expect(timer).toMatchObject({ status: 'idle', focus_run_id: null });
    expect((await http().get('/history').set(as(owner)).expect(200)).body.total).toBe(2);
  });

  it('rolls back history and timer state together if finalization fails', async () => {
    const owner = await registerUser(app);
    const room = await roomFor(owner);
    const time = controlTime();
    await pomodoro.start(owner.id, room.id);
    time.at(30_000);
    const history = app.get(HistoryService);
    const original = history.finishFocus.bind(history);
    const failure = jest.spyOn(history, 'finishFocus').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('simulated write failure');
    });
    await expect(pomodoro.cancel(owner.id, room.id)).rejects.toThrow('simulated write failure');
    failure.mockRestore();
    const [timer] = await ds.query('SELECT status FROM pomodoro_sessions WHERE room_id = $1', [
      room.id,
    ]);
    expect(timer.status).toBe('running');
    expect((await http().get('/history').set(as(owner)).expect(200)).body.total).toBe(0);
    await pomodoro.cancel(owner.id, room.id);
    const saved = await http().get('/history').set(as(owner)).expect(200);
    expect(saved.body.total).toBe(1);
    expect(saved.body.items[0].focusedSeconds).toBe(30);
  });

  it('supports task deletion concurrent with finalization and preserves the title snapshot', async () => {
    const owner = await registerUser(app);
    const task = await taskFor(owner, 'Keep this title');
    const room = await roomFor(owner);
    await pomodoro.start(owner.id, room.id);
    const [deletion] = await Promise.all([
      http().delete(`/tasks/${task.id}`).set(as(owner)),
      pomodoro.cancel(owner.id, room.id),
    ]);
    expect(deletion.status).toBe(204);
    const history = await http().get('/history').set(as(owner)).expect(200);
    expect(history.body.items[0]).toMatchObject({ taskId: null, taskTitle: 'Keep this title' });
  });

  it('filters and paginates real history and rejects client-created results', async () => {
    const owner = await registerUser(app);
    const room = await roomFor(owner);
    const time = controlTime();
    const cancelled = await pomodoro.start(owner.id, room.id);
    time.at(60_000);
    await pomodoro.cancel(owner.id, room.id);
    const completed = await pomodoro.start(owner.id, room.id);
    expect(completed.pomodoroSessionId).not.toBe(cancelled.pomodoroSessionId);
    time.at(1_560_001);
    await pomodoro.getState(owner.id, room.id);
    const page = await http().get('/history?limit=1&offset=1').set(as(owner)).expect(200);
    expect(page.body.total).toBe(2);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].pomodoroSessionId).toBe(cancelled.pomodoroSessionId);
    const stats = await http().get('/history/stats?status=completed').set(as(owner)).expect(200);
    expect(stats.body).toMatchObject({
      totalSessions: 1,
      completedSessions: 1,
      totalFocusedSeconds: 1500,
    });
    const from = new Date(time.start + 60_000).toISOString();
    const to = new Date(time.start + 61_000).toISOString();
    expect(
      (await http().get('/history').query({ from, to }).set(as(owner)).expect(200)).body.total,
    ).toBe(1);
    await http().get('/history').query({ from: to, to: from }).set(as(owner)).expect(400);
    await http().get('/history?limit=101').set(as(owner)).expect(400);
    await http().get('/history?offset=-1').set(as(owner)).expect(400);
    await http().get('/history').expect(401);
    await http()
      .post('/history')
      .set(as(owner))
      .send({ status: 'completed', focusedSeconds: 1500 })
      .expect(404);
  });

  it('reverts and reapplies the new migration without removing the existing timer table', async () => {
    await ds.undoLastMigration({ transaction: 'all' });
    try {
      const [tables] = await ds.query(
        "SELECT to_regclass('tasks') AS tasks, to_regclass('pomodoro_sessions') AS timer",
      );
      expect(tables).toEqual({ tasks: null, timer: 'pomodoro_sessions' });
    } finally {
      await ds.runMigrations({ transaction: 'each' });
    }
    const [tables] = await ds.query(
      "SELECT to_regclass('tasks') AS tasks, to_regclass('focus_history') AS history, to_regclass('pomodoro_runs') AS runs",
    );
    expect(tables).toEqual({ tasks: 'tasks', history: 'focus_history', runs: 'pomodoro_runs' });
  });
});
