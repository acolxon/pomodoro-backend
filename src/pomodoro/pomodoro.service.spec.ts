import { DataSource, EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RoomStatus } from '../rooms/entities/room.entity';
import { HistoryService } from '../history/history.service';
import { FocusHistoryStatus } from '../history/entities/focus-history.entity';
import { Room } from '../rooms/entities/room.entity';
import { PomodoroPhase, PomodoroSession, PomodoroStatus } from './entities/pomodoro-session.entity';
import { PomodoroService } from './pomodoro.service';

describe('Pomodoro lifecycle and history', () => {
  const base = new Date('2026-11-14T10:00:00.000Z');
  let service: PomodoroService;
  let row: PomodoroSession;
  let manager: EntityManager;
  let dataSource: DataSource;
  let focusedMilliseconds: number;
  let history: { beginFocus: jest.Mock; recordInterval: jest.Mock; finishFocus: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(base);
    focusedMilliseconds = 0;
    row = Object.assign(new PomodoroSession(), {
      roomId: 'room',
      focusRunId: null,
      status: PomodoroStatus.Idle,
      phase: null,
      durationSeconds: 1500,
      startedAt: null,
      endsAt: null,
      pausedAt: null,
      remainingSeconds: null,
      updatedBy: null,
    });
    history = {
      beginFocus: jest.fn().mockResolvedValue('run-1'),
      recordInterval: jest.fn(async (_manager, _id, from: Date, to: Date) => {
        focusedMilliseconds += to.getTime() - from.getTime();
      }),
      finishFocus: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      findOne: jest.fn(async (entity: unknown) =>
        entity === Room ? { id: 'room', ownerId: 'owner', status: RoomStatus.Open } : row,
      ),
      findOneBy: jest.fn().mockResolvedValue({ userId: 'owner' }),
      findOneOrFail: jest.fn().mockImplementation(async () => row),
      findOneByOrFail: jest
        .fn()
        .mockImplementation(async () => ({ plannedDurationSeconds: 1500, focusedMilliseconds })),
      query: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async (value: unknown) => value),
    } as unknown as EntityManager;
    dataSource = {
      transaction: jest.fn(async (action: (em: EntityManager) => unknown) => action(manager)),
      getRepository: jest.fn().mockReturnValue({ find: jest.fn(async () => [row]) }),
    } as unknown as DataSource;
    service = new PomodoroService(dataSource, history as unknown as HistoryService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('keeps the run identity and precise remaining time across a long pause', async () => {
    expect((await service.start('owner', 'room')).pomodoroSessionId).toBe('run-1');
    jest.setSystemTime(base.getTime() + 30_250);
    const paused = await service.pause('owner', 'room');
    expect(paused.remainingSeconds).toBe(1470);
    expect(history.finishFocus).not.toHaveBeenCalled();
    jest.setSystemTime(base.getTime() + 330_250);
    const resumed = await service.resume('owner', 'room');
    expect(resumed.pomodoroSessionId).toBe('run-1');
    expect(resumed.endsAt?.getTime()).toBe(base.getTime() + 1_800_000);
    expect(history.beginFocus).toHaveBeenCalledTimes(1);
  });

  it('cancels a paused Focus once and excludes the paused interval', async () => {
    await service.start('owner', 'room');
    jest.setSystemTime(base.getTime() + 40_000);
    await service.pause('owner', 'room');
    jest.setSystemTime(base.getTime() + 640_000);
    const cancelled = await service.cancel('owner', 'room');
    await service.cancel('owner', 'room');
    expect(cancelled).toMatchObject({ status: 'idle', phase: null, pomodoroSessionId: null });
    expect(focusedMilliseconds).toBe(40_000);
    expect(history.recordInterval).toHaveBeenCalledTimes(1);
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
    expect(history.finishFocus).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      FocusHistoryStatus.Cancelled,
      new Date(base.getTime() + 640_000),
    );
  });

  it('completes at the planned deadline when a timer callback arrives late', async () => {
    await service.start('owner', 'room');
    jest.setSystemTime(base.getTime() + 1_510_000);
    const state = await service.getState('owner', 'room');
    expect(state).toMatchObject({ phase: 'break', status: 'running', durationSeconds: 300 });
    expect(focusedMilliseconds).toBe(1_500_000);
    expect(history.finishFocus).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      FocusHistoryStatus.Completed,
      new Date(base.getTime() + 1_500_000),
    );
    await service.cancel('owner', 'room');
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
  });

  it('automatically records completion and restores scheduled work after restart', async () => {
    await service.start('owner', 'room');
    service.onModuleDestroy();
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_500_000);
    expect(row.phase).toBe(PomodoroPhase.Break);
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(row.status).toBe(PomodoroStatus.Idle);
    expect(row.focusRunId).toBeNull();
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
  });

  it('allows members to read the state and reserves timer controls for the owner', async () => {
    await expect(service.start('member', 'room')).rejects.toThrow('Только владелец');
    expect(history.beginFocus).not.toHaveBeenCalled();
    expect((await service.getState('member', 'room')).status).toBe('idle');
  });

  it('rejects a former member before accessing the timer or starting a run', async () => {
    (manager.findOneBy as jest.Mock).mockResolvedValue(null);
    await expect(service.getState('former-member', 'room')).rejects.toThrow('участником');
    await expect(service.start('former-member', 'room')).rejects.toThrow('участником');
    expect(manager.findOneOrFail).not.toHaveBeenCalled();
    expect(history.beginFocus).not.toHaveBeenCalled();
  });

  it('automatically cancels a paused Focus at the configured deadline without counting pause time', async () => {
    const broadcast = jest.fn();
    service.setBroadcaster(broadcast);
    await service.start('owner', 'room');
    await jest.advanceTimersByTimeAsync(30_000);
    await service.pause('owner', 'room');
    await jest.advanceTimersByTimeAsync(900_000);
    expect(row.status).toBe(PomodoroStatus.Idle);
    expect(focusedMilliseconds).toBe(30_000);
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
    expect(history.finishFocus).toHaveBeenCalledWith(
      manager,
      'run-1',
      FocusHistoryStatus.Cancelled,
      new Date(base.getTime() + 930_000),
    );
    expect(broadcast).toHaveBeenCalledWith(
      'room',
      expect.objectContaining({ status: 'idle', phase: null }),
    );
    await service.cancel('owner', 'room');
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
  });

  it('restores a paused timer after restart and retains the original pause deadline', async () => {
    await service.start('owner', 'room');
    await jest.advanceTimersByTimeAsync(30_000);
    await service.pause('owner', 'room');
    service.onModuleDestroy();
    jest.setSystemTime(base.getTime() + 300_000);
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(629_999);
    expect(row.status).toBe(PomodoroStatus.Paused);
    await jest.advanceTimersByTimeAsync(1);
    expect(row.status).toBe(PomodoroStatus.Idle);
    expect(history.finishFocus).toHaveBeenCalledWith(
      manager,
      'run-1',
      FocusHistoryStatus.Cancelled,
      new Date(base.getTime() + 930_000),
    );
  });

  it('cancels overdue paused runs immediately after restart using the deadline rather than recovery time', async () => {
    await service.start('owner', 'room');
    await jest.advanceTimersByTimeAsync(30_000);
    await service.pause('owner', 'room');
    service.onModuleDestroy();
    jest.setSystemTime(base.getTime() + 1_000_000);
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(row.status).toBe(PomodoroStatus.Idle);
    expect(history.finishFocus).toHaveBeenCalledWith(
      manager,
      'run-1',
      FocusHistoryStatus.Cancelled,
      new Date(base.getTime() + 930_000),
    );
  });

  it('cannot resume a Focus at or after its pause deadline', async () => {
    await service.start('owner', 'room');
    jest.setSystemTime(base.getTime() + 30_000);
    await service.pause('owner', 'room');
    jest.setSystemTime(base.getTime() + 930_000);
    const resumed = await service.resume('owner', 'room');
    expect(resumed.status).toBe(PomodoroStatus.Idle);
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
    expect(history.beginFocus).toHaveBeenCalledTimes(1);
  });

  it('expires a paused Break without duplicating or cancelling the completed Focus result', async () => {
    await service.start('owner', 'room');
    await jest.advanceTimersByTimeAsync(1_500_000);
    await service.pause('owner', 'room');
    await jest.advanceTimersByTimeAsync(900_000);
    expect(row.status).toBe(PomodoroStatus.Idle);
    expect(history.finishFocus).toHaveBeenCalledTimes(1);
    expect(history.finishFocus.mock.calls[0][2]).toBe(FocusHistoryStatus.Completed);
  });

  it('uses the server configuration for pause expiry', async () => {
    service.onModuleDestroy();
    service = new PomodoroService(
      dataSource,
      history as unknown as HistoryService,
      new ConfigService({ POMODORO_MAX_PAUSE_SECONDS: 10 }),
    );
    await service.start('owner', 'room');
    await service.pause('owner', 'room');
    await jest.advanceTimersByTimeAsync(9_999);
    expect(row.status).toBe(PomodoroStatus.Paused);
    await jest.advanceTimersByTimeAsync(1);
    expect(row.status).toBe(PomodoroStatus.Idle);
  });

  it('stops a scheduled pause expiry when the room lifecycle cancels its timer', async () => {
    await service.start('owner', 'room');
    await service.pause('owner', 'room');
    service.stopRoom('room');
    await jest.advanceTimersByTimeAsync(900_000);
    expect(history.finishFocus).not.toHaveBeenCalled();
  });

  it('rejects timer operations on a closed room before creating or modifying a run', async () => {
    (manager.findOne as jest.Mock).mockResolvedValue({
      id: 'room',
      ownerId: 'owner',
      status: RoomStatus.Closed,
    });
    await expect(service.start('owner', 'room')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ROOM_CLOSED' }),
    });
    expect(history.beginFocus).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
