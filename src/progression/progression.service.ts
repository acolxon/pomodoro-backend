import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FocusHistory, FocusHistoryStatus } from '../history/entities/focus-history.entity';
import { PomodoroParticipant } from '../history/entities/pomodoro-participant.entity';
import { PomodoroRun, PomodoroRunStatus } from '../history/entities/pomodoro-run.entity';
import { UserStats } from '../users/entities/user-stats.entity';
import { UserSettings } from '../users/entities/user-settings.entity';
import { EconomyTransaction } from './entities/economy-transaction.entity';
import { activityDate, boostedXp, focusReward, progressionForXp } from './progression.rules';

@Injectable()
export class ProgressionService {
  /** Runs inside finalization's transaction, with the run lock already held. */
  async awardFocus(manager: EntityManager, run: PomodoroRun): Promise<void> {
    if (
      run.status !== PomodoroRunStatus.Completed ||
      !run.endedAt ||
      run.focusedMilliseconds < run.plannedDurationSeconds * 1000
    )
      return;
    const participants = await manager.findBy(PomodoroParticipant, { runId: run.id });
    const results = await manager.findBy(FocusHistory, { pomodoroSessionId: run.id });
    const resultByUser = new Map(results.map((result) => [result.userId, result]));
    const eligible = participants.filter((participant) => {
      const result = resultByUser.get(participant.userId);
      return (
        result?.status === FocusHistoryStatus.Completed &&
        participant.focusedMilliseconds >= run.plannedDurationSeconds * 1000 &&
        result.focusedSeconds >= run.plannedDurationSeconds
      );
    });
    const teamBonus = participants.length >= 2 && eligible.length === participants.length;
    const reward = focusReward(teamBonus);
    // The same user can have old runs finalized concurrently in different rooms.
    // Lock stats in a stable order, so balances/counters never overwrite one another.
    eligible.sort((a, b) => a.userId.localeCompare(b.userId));
    for (const participant of eligible) {
      const stats = await manager.findOneOrFail(UserStats, {
        where: { userId: participant.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const key = {
        userId: participant.userId,
        sourceType: 'focus_completed' as const,
        sourceId: run.id,
      };
      if (await manager.existsBy(EconomyTransaction, key)) continue;
      const settings = await manager.findOneByOrFail(UserSettings, { userId: participant.userId });
      const day = activityDate(run.endedAt, settings.timezone);
      const activeOnDay = await manager.existsBy(EconomyTransaction, {
        userId: participant.userId,
        activityDate: day,
      });
      // Stats row serializes purchases and rewards for this user. A charge is consumed
      // only after eligibility and idempotency checks, inside the finalization transaction.
      // TypeORM's PostgreSQL runner returns [rows, affectedCount] for UPDATE.
      const [consumed]: [Array<{ quantity: number }>, number] = await manager.query(
        `UPDATE xp_booster_inventory SET quantity = quantity - 1, updated_at = now()
         WHERE user_id = $1 AND quantity > 0 RETURNING quantity`,
        [participant.userId],
      );
      const earnedXp = consumed.length ? boostedXp(reward.xp) : reward.xp;
      // Unique constraint is an additional guard; do not ignore unrelated DB errors.
      await manager.insert(EconomyTransaction, {
        ...key,
        xp: earnedXp,
        coins: reward.coins,
        teamBonus,
        activityDate: day,
        earnedAt: run.endedAt,
      });
      stats.xp += earnedXp;
      stats.coins += reward.coins;
      stats.level = progressionForXp(stats.xp).level;
      stats.sessionsCompleted += 1;
      if (eligible.length >= 2) stats.collabSessionsCompleted += 1;
      if (!activeOnDay) stats.activeDays += 1;
      if (!stats.lastActiveDate || day > stats.lastActiveDate) stats.lastActiveDate = day;
      await manager.save(stats);
      await manager.update(
        FocusHistory,
        { pomodoroSessionId: run.id, userId: participant.userId },
        {
          xpEarned: earnedXp,
          coinsEarned: reward.coins,
          teamBonus,
        },
      );
    }
  }
}
