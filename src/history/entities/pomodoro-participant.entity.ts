import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Task snapshot and accumulated membership time for one participant in a Focus run. */
@Entity('pomodoro_participants')
export class PomodoroParticipant {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' }) runId!: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'task_id', type: 'uuid', nullable: true }) taskId!: string | null;
  @Column({ name: 'task_title', type: 'varchar', length: 120, nullable: true }) taskTitle!:
    string | null;
  @Column({ name: 'focused_milliseconds', type: 'int', default: 0 }) focusedMilliseconds!: number;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true }) finishedAt!: Date | null;
}
