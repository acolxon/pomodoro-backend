import { EntityManager } from 'typeorm';
import { FocusHistory, FocusHistoryStatus } from '../history/entities/focus-history.entity';
import { PomodoroParticipant } from '../history/entities/pomodoro-participant.entity';
import { PomodoroRun, PomodoroRunStatus } from '../history/entities/pomodoro-run.entity';
import { UserSettings } from '../users/entities/user-settings.entity';
import { UserStats } from '../users/entities/user-stats.entity';
import { EconomyTransaction } from './entities/economy-transaction.entity';
import { ProgressionService } from './progression.service';

describe('ProgressionService', () => {
  const service = new ProgressionService();
  let participants: PomodoroParticipant[];
  let results: FocusHistory[];
  let stats: Map<string, UserStats>;
  let receipts: Partial<EconomyTransaction>[];
  let manager: EntityManager;
  let run: PomodoroRun;

  function add(userId: string, status = FocusHistoryStatus.Completed, milliseconds = 1_500_000) {
    participants.push({
      userId,
      runId: run.id,
      focusedMilliseconds: milliseconds,
    } as PomodoroParticipant);
    results.push({
      userId,
      status,
      focusedSeconds: Math.floor(milliseconds / 1000),
    } as FocusHistory);
    stats.set(userId, {
      userId,
      xp: 0,
      coins: 0,
      level: 1,
      sessionsCompleted: 0,
      collabSessionsCompleted: 0,
      activeDays: 0,
      lastActiveDate: null,
    } as UserStats);
  }

  beforeEach(() => {
    participants = [];
    results = [];
    stats = new Map();
    receipts = [];
    run = {
      id: 'run-1',
      status: PomodoroRunStatus.Completed,
      plannedDurationSeconds: 1500,
      focusedMilliseconds: 1_500_000,
      endedAt: new Date('2026-11-15T22:30:00Z'),
    } as PomodoroRun;
    manager = {
      findBy: jest.fn(async (entity) => (entity === PomodoroParticipant ? participants : results)),
      findOneOrFail: jest.fn(async (_entity, options) => stats.get(options.where.userId)),
      findOneByOrFail: jest.fn(async () => ({ timezone: 'Asia/Almaty' })),
      existsBy: jest.fn(async (_entity, key) =>
        receipts.some((receipt) =>
          Object.entries(key).every(
            ([name, value]) => receipt[name as keyof EconomyTransaction] === value,
          ),
        ),
      ),
      insert: jest.fn(async (_entity, receipt) => {
        receipts.push(receipt);
      }),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({})),
    } as unknown as EntityManager;
  });

  it('awards solo Focus once, updates level and activity in the same manager', async () => {
    add('alice');
    stats.get('alice')!.xp = 75;
    await service.awardFocus(manager, run);
    expect(stats.get('alice')).toMatchObject({
      xp: 100,
      coins: 10,
      level: 2,
      sessionsCompleted: 1,
      collabSessionsCompleted: 0,
      activeDays: 1,
      lastActiveDate: '2026-11-16',
    });
    expect(receipts).toEqual([
      expect.objectContaining({
        sourceId: run.id,
        userId: 'alice',
        xp: 25,
        coins: 10,
        teamBonus: false,
      }),
    ]);
    expect(manager.update).toHaveBeenCalledWith(
      FocusHistory,
      { pomodoroSessionId: run.id, userId: 'alice' },
      { xpEarned: 25, coinsEarned: 10, teamBonus: false },
    );
    await service.awardFocus(manager, run);
    expect(receipts).toHaveLength(1);
    expect(stats.get('alice')!.xp).toBe(100);
    expect(stats.get('alice')!.sessionsCompleted).toBe(1);
  });

  it('rewards all finishers with the team bonus and locks users in stable order', async () => {
    add('bob');
    add('alice');
    await service.awardFocus(manager, run);
    expect(receipts.map((value) => value.userId)).toEqual(['alice', 'bob']);
    for (const user of stats.values())
      expect(user).toMatchObject({ xp: 30, coins: 12, collabSessionsCompleted: 1 });
    expect(manager.findOneOrFail).toHaveBeenCalledWith(
      UserStats,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('gives no reward for early departure or partial time and removes team bonus', async () => {
    add('alice');
    add('bob', FocusHistoryStatus.Cancelled, 60_000);
    add('partial', FocusHistoryStatus.Completed, 1_499_999);
    await service.awardFocus(manager, run);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ userId: 'alice', xp: 25, teamBonus: false });
    expect(stats.get('bob')!.xp).toBe(0);
    expect(stats.get('partial')!.xp).toBe(0);
  });

  it('does not reward a late user with no enrollment even if a result exists', async () => {
    add('alice');
    results.push({
      userId: 'late',
      status: FocusHistoryStatus.Completed,
      focusedSeconds: 1500,
    } as FocusHistory);
    await service.awardFocus(manager, run);
    expect(receipts.map((value) => value.userId)).toEqual(['alice']);
  });

  it('requires the run itself to have the full focused time', async () => {
    add('alice');
    run.focusedMilliseconds = 1_499_000;
    await service.awardFocus(manager, run);
    expect(receipts).toHaveLength(0);
  });

  it('awards participants already finalized by a departure after the deadline', async () => {
    add('alice');
    participants[0].finishedAt = run.endedAt;
    await service.awardFocus(manager, run);
    expect(receipts[0]).toMatchObject({ userId: 'alice', xp: 25, coins: 10 });
  });

  it.each([PomodoroRunStatus.Cancelled, PomodoroRunStatus.Running])(
    'ignores a %s run',
    async (status) => {
      add('alice');
      run.status = status;
      await service.awardFocus(manager, run);
      expect(manager.findBy).not.toHaveBeenCalled();
      expect(receipts).toHaveLength(0);
    },
  );

  it('counts an activity day once across different runs', async () => {
    add('alice');
    await service.awardFocus(manager, run);
    run.id = 'run-2';
    await service.awardFocus(manager, run);
    expect(stats.get('alice')).toMatchObject({ xp: 50, activeDays: 1, sessionsCompleted: 2 });
  });

  it('handles recovery of older days without moving the last activity date backwards', async () => {
    add('alice');
    await service.awardFocus(manager, run);
    run.id = 'old-run';
    run.endedAt = new Date('2026-11-13T12:00:00Z');
    await service.awardFocus(manager, run);
    expect(stats.get('alice')).toMatchObject({ activeDays: 2, lastActiveDate: '2026-11-16' });
  });

  it('propagates receipt failures so the caller rolls back all writes', async () => {
    add('alice');
    jest.spyOn(manager, 'insert').mockRejectedValueOnce(new Error('write failed'));
    await expect(service.awardFocus(manager, run)).rejects.toThrow('write failed');
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.findOneByOrFail).toHaveBeenCalledWith(UserSettings, { userId: 'alice' });
  });
});
