import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoomsService } from '../rooms/rooms.service';
import { PomodoroPhase, PomodoroSession, PomodoroStatus } from './entities/pomodoro-session.entity';
import { PomodoroStateDto } from './dto/pomodoro-state.dto';

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const MAX_TIMEOUT = 2_147_000_000;

@Injectable()
export class PomodoroService implements OnModuleInit {
  private readonly logger = new Logger(PomodoroService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private broadcaster?: (roomId: string, state: PomodoroStateDto) => void;

  constructor(
    private readonly dataSource: DataSource,
    private readonly rooms: RoomsService,
  ) {}

  /** Set by the gateway so automatic phase changes are broadcast to connected members. */
  setBroadcaster(callback: (roomId: string, state: PomodoroStateDto) => void): void {
    this.broadcaster = callback;
  }

  async onModuleInit(): Promise<void> {
    try {
      const running = await this.dataSource.getRepository(PomodoroSession).find({
        where: { status: PomodoroStatus.Running },
      });
      for (const session of running) this.schedule(session.roomId, session.endsAt);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : undefined;
      // The existing e2e harness creates the schema after app.init(); production must run migrations first.
      if (code !== '42P01') throw error;
      this.logger.warn('Pomodoro recovery skipped: pomodoro_sessions table is not available yet');
    }
  }

  async getState(userId: string, roomId: string): Promise<PomodoroStateDto> {
    await this.rooms.getRoom(userId, roomId);
    await this.ensureRow(roomId);
    await this.advanceIfExpired(roomId);
    const session = await this.dataSource.getRepository(PomodoroSession).findOneByOrFail({ roomId });
    return this.toState(session);
  }

  async start(userId: string, roomId: string): Promise<PomodoroStateDto> {
    await this.assertOwner(userId, roomId);
    const session = await this.mutate(roomId, (row) => {
      if (row.status !== PomodoroStatus.Idle) return;
      this.beginPhase(row, PomodoroPhase.Focus, FOCUS_SECONDS);
      row.updatedBy = userId;
    });
    this.schedule(roomId, session.endsAt);
    return this.toState(session);
  }

  async pause(userId: string, roomId: string): Promise<PomodoroStateDto> {
    await this.assertOwner(userId, roomId);
    const session = await this.mutate(roomId, (row) => {
      if (row.status !== PomodoroStatus.Running || !row.endsAt) return;
      const now = new Date();
      row.remainingSeconds = Math.max(0, Math.ceil((row.endsAt.getTime() - now.getTime()) / 1000));
      row.status = PomodoroStatus.Paused;
      row.pausedAt = now;
      row.startedAt = null;
      row.endsAt = null;
      row.updatedBy = userId;
    });
    this.clearSchedule(roomId);
    return this.toState(session);
  }

  async resume(userId: string, roomId: string): Promise<PomodoroStateDto> {
    await this.assertOwner(userId, roomId);
    const session = await this.mutate(roomId, (row) => {
      if (row.status !== PomodoroStatus.Paused || row.remainingSeconds === null || !row.phase) return;
      const now = new Date();
      row.status = PomodoroStatus.Running;
      row.startedAt = now;
      row.endsAt = new Date(now.getTime() + row.remainingSeconds * 1000);
      row.pausedAt = null;
      row.updatedBy = userId;
    });
    this.schedule(roomId, session.endsAt);
    return this.toState(session);
  }

  async cancel(userId: string, roomId: string): Promise<PomodoroStateDto> {
    await this.assertOwner(userId, roomId);
    const session = await this.mutate(roomId, (row) => {
      row.status = PomodoroStatus.Idle;
      row.phase = null;
      row.durationSeconds = FOCUS_SECONDS;
      row.startedAt = null;
      row.endsAt = null;
      row.pausedAt = null;
      row.remainingSeconds = null;
      row.updatedBy = userId;
    });
    this.clearSchedule(roomId);
    return this.toState(session);
  }

  private async assertOwner(userId: string, roomId: string): Promise<void> {
    const room = await this.rooms.getRoom(userId, roomId);
    if (room.ownerId !== userId) throw new ForbiddenException('Только владелец комнаты может управлять таймером');
    await this.advanceIfExpired(roomId);
  }

  private async ensureRow(roomId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO pomodoro_sessions (room_id, status, duration_seconds) VALUES ($1, 'idle', $2) ON CONFLICT (room_id) DO NOTHING`,
      [roomId, FOCUS_SECONDS],
    );
  }

  private async mutate(
    roomId: string,
    change: (session: PomodoroSession) => void,
  ): Promise<PomodoroSession> {
    await this.ensureRow(roomId);
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(PomodoroSession, {
        where: { roomId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new Error('Pomodoro session row was not created');
      change(row);
      return manager.save(row);
    });
  }

  private beginPhase(row: PomodoroSession, phase: PomodoroPhase, seconds: number): void {
    const now = new Date();
    row.status = PomodoroStatus.Running;
    row.phase = phase;
    row.durationSeconds = seconds;
    row.startedAt = now;
    row.endsAt = new Date(now.getTime() + seconds * 1000);
    row.pausedAt = null;
    row.remainingSeconds = null;
  }

  private async advanceIfExpired(roomId: string): Promise<void> {
    const current = await this.dataSource.getRepository(PomodoroSession).findOneBy({ roomId });
    if (!current || current.status !== PomodoroStatus.Running || !current.endsAt || current.endsAt > new Date()) return;
    const updated = await this.mutate(roomId, (row) => {
      if (row.status !== PomodoroStatus.Running || !row.endsAt || row.endsAt > new Date()) return;
      if (row.phase === PomodoroPhase.Focus) {
        this.beginPhase(row, PomodoroPhase.Break, BREAK_SECONDS);
      } else {
        row.status = PomodoroStatus.Idle;
        row.phase = null;
        row.durationSeconds = FOCUS_SECONDS;
        row.startedAt = null;
        row.endsAt = null;
        row.pausedAt = null;
        row.remainingSeconds = null;
      }
    });
    if (updated.status === PomodoroStatus.Running) this.schedule(roomId, updated.endsAt);
    else this.clearSchedule(roomId);
    this.broadcaster?.(roomId, this.toState(updated));
  }

  private schedule(roomId: string, endsAt: Date | null): void {
    this.clearSchedule(roomId);
    if (!endsAt) return;
    const delay = Math.max(0, Math.min(MAX_TIMEOUT, endsAt.getTime() - Date.now()));
    const handle = setTimeout(() => {
      void this.advanceIfExpired(roomId).catch((error: unknown) => {
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
      status: row.status,
      phase: row.phase,
      durationSeconds: row.durationSeconds,
      startedAt: row.startedAt,
      endsAt: row.endsAt,
      pausedAt: row.pausedAt,
      remainingSeconds: row.remainingSeconds,
      serverTime: new Date(),
    };
  }
}
