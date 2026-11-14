import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { FocusHistoryStatus } from '../history/entities/focus-history.entity';
import { PomodoroRun } from '../history/entities/pomodoro-run.entity';
import { HistoryService } from '../history/history.service';
import { RoomMember } from '../rooms/entities/room-member.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';
import { roomErrors } from '../rooms/rooms.errors';
import { PomodoroPhase, PomodoroSession, PomodoroStatus } from './entities/pomodoro-session.entity';
import { PomodoroStateDto } from './dto/pomodoro-state.dto';

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const MAX_TIMEOUT = 2_147_000_000;
type SessionChange = (
  row: PomodoroSession,
  manager: EntityManager,
  now: Date,
) => void | Promise<void>;

@Injectable()
export class PomodoroService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PomodoroService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxPauseMilliseconds: number;
  private broadcaster?: (roomId: string, state: PomodoroStateDto) => void;

  constructor(
    private readonly dataSource: DataSource,
    private readonly history: HistoryService,
    @Optional() config?: ConfigService,
  ) {
    this.maxPauseMilliseconds = (config?.get<number>('POMODORO_MAX_PAUSE_SECONDS') ?? 900) * 1000;
  }

  setBroadcaster(callback: (roomId: string, state: PomodoroStateDto) => void): void {
    this.broadcaster = callback;
  }

  async onModuleInit(): Promise<void> {
    try {
      const running = await this.dataSource.getRepository(PomodoroSession).find({
        where: [{ status: PomodoroStatus.Running }, { status: PomodoroStatus.Paused }],
      });
      for (const session of running) this.scheduleSession(session);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : undefined;
      // A fresh installation may not have run its first migration yet.
      if (code !== '42P01') throw error;
      this.logger.warn('Pomodoro recovery skipped: pomodoro_sessions table is not available yet');
    }
  }

  onModuleDestroy(): void {
    for (const roomId of this.timers.keys()) this.clearSchedule(roomId);
  }

  getState(userId: string, roomId: string): Promise<PomodoroStateDto> {
    return this.mutate(roomId, userId, false, () => {});
  }

  /** Read under the room lock already held by the snapshot transaction.
   * getState initializes/advances the timer before this read; no nested transaction.
   */
  async readState(manager: EntityManager, roomId: string): Promise<PomodoroStateDto> {
    return this.toState(await manager.findOneByOrFail(PomodoroSession, { roomId }));
  }

  stopRoom(roomId: string): void {
    this.clearSchedule(roomId);
  }

  start(userId: string, roomId: string): Promise<PomodoroStateDto> {
    return this.mutate(roomId, userId, true, async (row, manager, now) => {
      if (row.status !== PomodoroStatus.Idle) return;
      this.beginPhase(row, PomodoroPhase.Focus, FOCUS_SECONDS, now);
      row.focusRunId = await this.history.beginFocus(manager, roomId, now, FOCUS_SECONDS);
      row.updatedBy = userId;
    });
  }

  pause(userId: string, roomId: string): Promise<PomodoroStateDto> {
    return this.mutate(roomId, userId, true, async (row, manager, now) => {
      if (row.status !== PomodoroStatus.Running || !row.endsAt) return;
      await this.recordFocusInterval(manager, row, now);
      row.remainingSeconds = Math.max(0, Math.ceil((row.endsAt.getTime() - now.getTime()) / 1000));
      row.status = PomodoroStatus.Paused;
      row.pausedAt = now;
      row.startedAt = null;
      row.endsAt = null;
      row.updatedBy = userId;
    });
  }

  resume(userId: string, roomId: string): Promise<PomodoroStateDto> {
    return this.mutate(roomId, userId, true, async (row, manager, now) => {
      if (row.status !== PomodoroStatus.Paused || row.remainingSeconds === null || !row.phase)
        return;
      let remainingMilliseconds = row.remainingSeconds * 1000;
      if (row.phase === PomodoroPhase.Focus && row.focusRunId) {
        const run = await manager.findOneByOrFail(PomodoroRun, { id: row.focusRunId });
        remainingMilliseconds = run.plannedDurationSeconds * 1000 - run.focusedMilliseconds;
      }
      row.status = PomodoroStatus.Running;
      row.startedAt = now;
      row.endsAt = new Date(now.getTime() + remainingMilliseconds);
      row.pausedAt = null;
      row.remainingSeconds = null;
      row.updatedBy = userId;
    });
  }

  cancel(userId: string, roomId: string): Promise<PomodoroStateDto> {
    return this.mutate(roomId, userId, true, async (row, manager, now) => {
      if (row.phase === PomodoroPhase.Focus && row.focusRunId) {
        await this.recordFocusInterval(manager, row, now);
        await this.history.finishFocus(manager, row.focusRunId, FocusHistoryStatus.Cancelled, now);
      }
      this.reset(row);
      row.updatedBy = userId;
    });
  }

  /** Room -> timer -> run locks match membership changes and serialize finalization. */
  private async mutate(
    roomId: string,
    userId: string | null,
    ownerOnly: boolean,
    change: SessionChange,
  ): Promise<PomodoroStateDto> {
    const { session, advanced } = await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(Room, {
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!room) throw roomErrors.notFound();
      if (room.status === RoomStatus.Closed) throw roomErrors.closed();
      if (userId !== null) {
        const member = await manager.findOneBy(RoomMember, { roomId, userId, leftAt: IsNull() });
        if (!member) throw roomErrors.notMemberOfRoom();
        if (ownerOnly && room.ownerId !== userId) {
          throw new ForbiddenException('Только владелец комнаты может управлять таймером');
        }
      }
      await manager.query(
        `INSERT INTO pomodoro_sessions (room_id, status, duration_seconds) VALUES ($1, 'idle', $2) ON CONFLICT (room_id) DO NOTHING`,
        [roomId, FOCUS_SECONDS],
      );
      const row = await manager.findOneOrFail(PomodoroSession, {
        where: { roomId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date(Date.now());
      const advanced = await this.advanceIfExpired(manager, row, now);
      await change(row, manager, now);
      return { session: await manager.save(row), advanced };
    });
    this.scheduleSession(session);
    const state = this.toState(session);
    if (advanced) this.broadcaster?.(roomId, state);
    return state;
  }

  private beginPhase(row: PomodoroSession, phase: PomodoroPhase, seconds: number, now: Date): void {
    row.status = PomodoroStatus.Running;
    row.phase = phase;
    row.durationSeconds = seconds;
    row.startedAt = now;
    row.endsAt = new Date(now.getTime() + seconds * 1000);
    row.pausedAt = null;
    row.remainingSeconds = null;
  }

  private reset(row: PomodoroSession): void {
    row.status = PomodoroStatus.Idle;
    row.phase = null;
    row.durationSeconds = FOCUS_SECONDS;
    row.startedAt = null;
    row.endsAt = null;
    row.pausedAt = null;
    row.remainingSeconds = null;
    row.focusRunId = null;
  }

  private async recordFocusInterval(
    manager: EntityManager,
    row: PomodoroSession,
    now: Date,
  ): Promise<void> {
    if (row.phase === PomodoroPhase.Focus && row.focusRunId && row.startedAt && row.endsAt) {
      await this.history.recordInterval(
        manager,
        row.focusRunId,
        row.startedAt,
        new Date(Math.min(now.getTime(), row.endsAt.getTime())),
      );
    }
  }

  private async advanceIfExpired(
    manager: EntityManager,
    row: PomodoroSession,
    now: Date,
  ): Promise<boolean> {
    if (row.status === PomodoroStatus.Paused && row.pausedAt) {
      const deadline = new Date(row.pausedAt.getTime() + this.maxPauseMilliseconds);
      if (deadline > now) return false;
      if (row.phase === PomodoroPhase.Focus && row.focusRunId) {
        await this.history.finishFocus(
          manager,
          row.focusRunId,
          FocusHistoryStatus.Cancelled,
          deadline,
        );
      }
      this.reset(row);
      return true;
    }
    if (row.status !== PomodoroStatus.Running || !row.endsAt || row.endsAt > now) return false;
    if (row.phase === PomodoroPhase.Focus) {
      await this.recordFocusInterval(manager, row, row.endsAt);
      if (row.focusRunId)
        await this.history.finishFocus(
          manager,
          row.focusRunId,
          FocusHistoryStatus.Completed,
          row.endsAt,
        );
      this.beginPhase(row, PomodoroPhase.Break, BREAK_SECONDS, now);
    } else {
      this.reset(row);
    }
    return true;
  }

  private scheduleSession(row: PomodoroSession): void {
    if (row.status === PomodoroStatus.Running) this.schedule(row.roomId, row.endsAt);
    else if (row.status === PomodoroStatus.Paused && row.pausedAt) {
      this.schedule(row.roomId, new Date(row.pausedAt.getTime() + this.maxPauseMilliseconds));
    } else this.clearSchedule(row.roomId);
  }

  private schedule(roomId: string, endsAt: Date | null): void {
    this.clearSchedule(roomId);
    if (!endsAt) return;
    const delay = Math.max(0, Math.min(MAX_TIMEOUT, endsAt.getTime() - Date.now()));
    const handle = setTimeout(() => {
      void this.mutate(roomId, null, false, () => {}).catch((error: unknown) => {
        this.clearSchedule(roomId);
        this.logger.error(`Failed to advance Pomodoro for room ${roomId}`, error);
      });
    }, delay);
    this.timers.set(roomId, handle);
  }

  private clearSchedule(roomId: string): void {
    const handle = this.timers.get(roomId);
    if (handle) clearTimeout(handle);
    this.timers.delete(roomId);
  }

  private toState(row: PomodoroSession): PomodoroStateDto {
    return {
      roomId: row.roomId,
      pomodoroSessionId: row.focusRunId,
      status: row.status,
      phase: row.phase,
      durationSeconds: row.durationSeconds,
      startedAt: row.startedAt,
      endsAt: row.endsAt,
      pausedAt: row.pausedAt,
      remainingSeconds: row.remainingSeconds,
      serverTime: new Date(Date.now()),
    };
  }
}
