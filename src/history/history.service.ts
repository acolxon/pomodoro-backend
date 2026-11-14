import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { RoomMember } from '../rooms/entities/room-member.entity';
import { Room } from '../rooms/entities/room.entity';
import { HistoryRoomDto } from './dto/history-room.dto';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { HistoryQueryDto } from './dto/history-query.dto';
import { HistoryStatsQueryDto } from './dto/history-stats-query.dto';
import { HistoryStatsDto } from './dto/history-stats.dto';
import { HistoryPageDto } from './dto/history-page.dto';
import { FocusHistory, FocusHistoryStatus } from './entities/focus-history.entity';
import { PomodoroParticipant } from './entities/pomodoro-participant.entity';
import { PomodoroRun, PomodoroRunStatus } from './entities/pomodoro-run.entity';
import { historyErrors } from './history.errors';
import { ProgressionService } from '../progression/progression.service';
import {
  PomodoroPhase,
  PomodoroSession,
  PomodoroStatus,
} from '../pomodoro/entities/pomodoro-session.entity';

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(FocusHistory) private readonly history: Repository<FocusHistory>,
    private readonly progression: ProgressionService,
  ) {}

  /** Caller holds the room/timer locks; all writes share the timer transaction. */
  async beginFocus(
    manager: EntityManager,
    roomId: string,
    startedAt: Date,
    plannedDurationSeconds: number,
  ): Promise<string> {
    const room = await manager.findOneByOrFail(Room, { id: roomId });
    const run = await manager.save(
      manager.create(PomodoroRun, {
        roomId,
        roomName: room.name,
        startedAt,
        plannedDurationSeconds,
        focusedMilliseconds: 0,
        status: PomodoroRunStatus.Running,
        endedAt: null,
      }),
    );
    const members = await manager.find(RoomMember, { where: { roomId, leftAt: IsNull() } });
    if (members.length > 0) {
      const tasks = await manager.find(Task, {
        where: {
          userId: In(members.map((member) => member.userId)),
          status: TaskStatus.InProgress,
        },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      });
      const taskByUser = new Map(tasks.map((task) => [task.userId, task]));
      await manager.insert(
        PomodoroParticipant,
        members.map((member) => ({
          runId: run.id,
          userId: member.userId,
          taskId: taskByUser.get(member.userId)?.id ?? null,
          taskTitle: taskByUser.get(member.userId)?.title ?? null,
          focusedMilliseconds: 0,
          finishedAt: null,
        })),
      );
    }
    return run.id;
  }

  /** Close one running interval. Departures finish participants in the same room transaction. */
  async recordInterval(
    manager: EntityManager,
    runId: string,
    from: Date,
    to: Date,
    userId?: string,
  ): Promise<void> {
    if (to <= from) return;
    const run = await manager.findOneOrFail(PomodoroRun, {
      where: { id: runId },
      lock: { mode: 'pessimistic_write' },
    });
    if (run.status !== PomodoroRunStatus.Running) return;
    await this.lockParticipantTasks(manager, runId);
    const maximum = run.plannedDurationSeconds * 1000;
    // Departing participants close only their own interval; the shared interval stays open.
    if (!userId) {
      run.focusedMilliseconds = Math.min(
        maximum,
        run.focusedMilliseconds + to.getTime() - from.getTime(),
      );
      await manager.save(run);
    }
    await manager.query(
      `
      UPDATE pomodoro_participants SET
        focused_milliseconds = LEAST($3::integer, focused_milliseconds + $2::integer)
      WHERE run_id = $1 AND finished_at IS NULL
        AND ($4::uuid IS NULL OR user_id = $4::uuid)
    `,
      [runId, to.getTime() - from.getTime(), maximum, userId ?? null],
    );
  }

  async finishFocus(
    manager: EntityManager,
    runId: string,
    status: FocusHistoryStatus,
    endedAt: Date,
  ): Promise<void> {
    const run = await manager.findOneOrFail(PomodoroRun, {
      where: { id: runId },
      lock: { mode: 'pessimistic_write' },
    });
    if (run.status !== PomodoroRunStatus.Running) return;
    endedAt = new Date(Math.max(endedAt.getTime(), run.startedAt.getTime()));
    await this.lockParticipantTasks(manager, runId);
    const participants = await manager.findBy(PomodoroParticipant, { runId, finishedAt: IsNull() });
    if (participants.length > 0) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(FocusHistory)
        .values(
          participants.map((participant) => ({
            userId: participant.userId,
            taskId: participant.taskId,
            taskTitle: participant.taskTitle,
            roomId: run.roomId,
            roomName: run.roomName,
            pomodoroSessionId: run.id,
            status,
            plannedDurationSeconds: run.plannedDurationSeconds,
            focusedSeconds: Math.floor(participant.focusedMilliseconds / 1000),
            startedAt: run.startedAt,
            endedAt,
          })),
        )
        .orIgnore()
        .execute();
      await manager.update(
        PomodoroParticipant,
        { runId, finishedAt: IsNull() },
        { finishedAt: endedAt },
      );
    }
    run.status =
      status === FocusHistoryStatus.Completed
        ? PomodoroRunStatus.Completed
        : PomodoroRunStatus.Cancelled;
    run.endedAt = endedAt;
    await manager.save(run);
    await this.progression.awardFocus(manager, run);
  }

  /** Called inside the membership transaction, after left_at has been recorded. */
  async memberLeft(
    manager: EntityManager,
    roomId: string,
    userId: string,
    leftAt: Date,
  ): Promise<void> {
    const timer = await manager.findOne(PomodoroSession, {
      where: { roomId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!timer?.focusRunId || timer.phase !== PomodoroPhase.Focus) return;
    const runId = timer.focusRunId;
    await this.lockParticipantTasks(manager, runId);
    const existing = await manager.findOneBy(PomodoroParticipant, {
      runId,
      userId,
      finishedAt: IsNull(),
    });
    if (!existing) return;
    const endedAt = timer.endsAt
      ? new Date(Math.min(leftAt.getTime(), timer.endsAt.getTime()))
      : leftAt;
    if (timer.startedAt && timer.endsAt) {
      await this.recordInterval(manager, runId, timer.startedAt, endedAt, userId);
    }
    const run = await manager.findOneByOrFail(PomodoroRun, { id: runId });
    if (run.status !== PomodoroRunStatus.Running) return;
    const participant = await manager.findOneByOrFail(PomodoroParticipant, { runId, userId });
    const resultTime = new Date(Math.max(endedAt.getTime(), run.startedAt.getTime()));
    await manager
      .createQueryBuilder()
      .insert()
      .into(FocusHistory)
      .values({
        userId,
        taskId: participant.taskId,
        taskTitle: participant.taskTitle,
        roomId,
        roomName: run.roomName,
        pomodoroSessionId: runId,
        status:
          timer.endsAt && timer.endsAt <= leftAt
            ? FocusHistoryStatus.Completed
            : FocusHistoryStatus.Cancelled,
        plannedDurationSeconds: run.plannedDurationSeconds,
        focusedSeconds: Math.floor(participant.focusedMilliseconds / 1000),
        startedAt: run.startedAt,
        endedAt: resultTime,
      })
      .orIgnore()
      .execute();
    participant.finishedAt = resultTime;
    await manager.save(participant);
  }

  /** Closing an empty room also terminates a paused Focus, which has no scheduled timer. */
  async closeRoomFocus(manager: EntityManager, roomId: string, closedAt: Date): Promise<void> {
    const timer = await manager.findOne(PomodoroSession, {
      where: { roomId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!timer) return;
    if (timer.phase === PomodoroPhase.Focus && timer.focusRunId) {
      const endedAt = timer.endsAt
        ? new Date(Math.min(closedAt.getTime(), timer.endsAt.getTime()))
        : closedAt;
      if (timer.startedAt && timer.endsAt)
        await this.recordInterval(manager, timer.focusRunId, timer.startedAt, endedAt);
      await this.finishFocus(
        manager,
        timer.focusRunId,
        timer.endsAt && timer.endsAt <= closedAt
          ? FocusHistoryStatus.Completed
          : FocusHistoryStatus.Cancelled,
        endedAt,
      );
    }
    timer.status = PomodoroStatus.Idle;
    timer.phase = null;
    timer.durationSeconds = 1500;
    timer.startedAt = timer.endsAt = timer.pausedAt = null;
    timer.remainingSeconds = null;
    timer.focusRunId = null;
    await manager.save(timer);
  }

  async findAll(userId: string, query: HistoryQueryDto): Promise<HistoryPageDto> {
    const [items, total] = await this.filteredQuery(userId, query)
      .orderBy('history.startedAt', 'DESC')
      .addOrderBy('history.id', 'DESC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 50)
      .getManyAndCount();
    return { items, total };
  }

  /** Task deletion cascades to participants: take task locks before updating participants. */
  private async lockParticipantTasks(manager: EntityManager, runId: string): Promise<void> {
    await manager
      .createQueryBuilder(Task, 'task')
      .where('task.id IN (SELECT task_id FROM pomodoro_participants WHERE run_id = :runId)', {
        runId,
      })
      .orderBy('task.id', 'ASC')
      .setLock('pessimistic_read')
      .getMany();
  }

  async findOne(userId: string, id: string): Promise<FocusHistory> {
    const record = await this.history.findOneBy({ id, userId });
    if (!record) throw historyErrors.notFound();
    return record;
  }

  async getRooms(userId: string): Promise<HistoryRoomDto[]> {
    return this.history
      .createQueryBuilder('history')
      .select('history.roomId', 'id')
      .addSelect('history.roomName', 'name')
      .distinctOn(['history.roomId'])
      .where('history.userId = :userId', { userId })
      .andWhere('history.roomId IS NOT NULL')
      .orderBy('history.roomId', 'ASC')
      .addOrderBy('history.startedAt', 'DESC')
      .addOrderBy('history.id', 'DESC')
      .getRawMany<HistoryRoomDto>();
  }

  async getStats(userId: string, query: HistoryStatsQueryDto): Promise<HistoryStatsDto> {
    const row = await this.filteredQuery(userId, query)
      .select('COUNT(*)', 'totalSessions')
      .addSelect("COUNT(*) FILTER (WHERE history.status = 'completed')", 'completedSessions')
      .addSelect("COUNT(*) FILTER (WHERE history.status = 'cancelled')", 'cancelledSessions')
      .addSelect('COALESCE(SUM(history.focusedSeconds), 0)', 'totalFocusedSeconds')
      .getRawOne<{
        totalSessions: string;
        completedSessions: string;
        cancelledSessions: string;
        totalFocusedSeconds: string;
      }>();
    const totalSessions = Number(row?.totalSessions ?? 0);
    const totalFocusedSeconds = Number(row?.totalFocusedSeconds ?? 0);
    return {
      totalSessions,
      completedSessions: Number(row?.completedSessions ?? 0),
      cancelledSessions: Number(row?.cancelledSessions ?? 0),
      totalFocusedSeconds,
      totalFocusedMinutes: Math.floor(totalFocusedSeconds / 60),
      averageFocusedSeconds: totalSessions ? Math.round(totalFocusedSeconds / totalSessions) : 0,
    };
  }

  private filteredQuery(
    userId: string,
    query: HistoryStatsQueryDto,
  ): SelectQueryBuilder<FocusHistory> {
    if (query.from && query.to && new Date(query.from) >= new Date(query.to))
      throw historyErrors.invalidPeriod();
    const builder = this.history
      .createQueryBuilder('history')
      .where('history.userId = :userId', { userId });
    if (query.status) builder.andWhere('history.status = :status', { status: query.status });
    if (query.roomId) builder.andWhere('history.roomId = :roomId', { roomId: query.roomId });
    if (query.from) builder.andWhere('history.startedAt >= :from', { from: query.from });
    if (query.to) builder.andWhere('history.startedAt < :to', { to: query.to });
    return builder;
  }
}
