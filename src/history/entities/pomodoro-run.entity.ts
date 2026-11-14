import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum PomodoroRunStatus {
  Running = 'running',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

/** One persistent identity for a Focus phase, including all pauses and resumes. */
@Entity('pomodoro_runs')
export class PomodoroRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'room_id', type: 'uuid', nullable: true }) roomId!: string | null;
  @Column({ name: 'room_name', type: 'varchar', length: 50, nullable: true }) roomName!:
    string | null;
  @Column({ name: 'planned_duration_seconds', type: 'int' }) plannedDurationSeconds!: number;
  @Column({ name: 'focused_milliseconds', type: 'int', default: 0 }) focusedMilliseconds!: number;
  @Column({ type: 'varchar', length: 16 }) status!: PomodoroRunStatus;
  @Column({ name: 'started_at', type: 'timestamptz' }) startedAt!: Date;
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true }) endedAt!: Date | null;
}
