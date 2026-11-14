import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum FocusHistoryStatus {
  Completed = 'completed',
  Cancelled = 'cancelled',
}

@Entity('focus_history')
export class FocusHistory {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  /** Снимок названия сохраняет понятную историю после удаления задачи. */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'task_title', type: 'varchar', length: 120, nullable: true })
  taskTitle!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Название комнаты на момент запуска' })
  @Column({ name: 'room_name', type: 'varchar', length: 50, nullable: true })
  roomName!: string | null;

  /** Постоянный ID запуска Focus, общий для его участников. */
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'pomodoro_session_id', type: 'uuid' })
  pomodoroSessionId!: string;

  @ApiProperty({ enum: FocusHistoryStatus })
  @Column({ type: 'varchar', length: 16 })
  status!: FocusHistoryStatus;

  @ApiProperty({ example: 1500 })
  @Column({ name: 'planned_duration_seconds', type: 'int' })
  plannedDurationSeconds!: number;

  @ApiProperty({ example: 1500 })
  @Column({ name: 'focused_seconds', type: 'int' })
  focusedSeconds!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Column({ name: 'ended_at', type: 'timestamptz' })
  endedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
