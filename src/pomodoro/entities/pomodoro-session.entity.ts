import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum PomodoroStatus {
  Idle = 'idle',
  Running = 'running',
  Paused = 'paused',
}

export enum PomodoroPhase {
  Focus = 'focus',
  Break = 'break',
}

/** One persisted, shared timer per room. Timestamps are authoritative server time. */
@Entity('pomodoro_sessions')
export class PomodoroSession {
  @PrimaryColumn({ name: 'room_id', type: 'uuid' })
  roomId!: string;

  @Column({ name: 'focus_run_id', type: 'uuid', nullable: true })
  focusRunId!: string | null;

  @Column({ type: 'varchar', length: 16, default: PomodoroStatus.Idle })
  status!: PomodoroStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phase!: PomodoroPhase | null;

  @Column({ name: 'duration_seconds', type: 'integer', default: 1500 })
  durationSeconds!: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;

  @Column({ name: 'remaining_seconds', type: 'integer', nullable: true })
  remainingSeconds!: number | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
