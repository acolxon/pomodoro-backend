import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TaskStatus {
  Todo = 'todo',
  InProgress = 'in_progress',
  Completed = 'completed',
}

@Entity('tasks')
export class Task {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'Finish backend API', maxLength: 120 })
  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @ApiProperty({ enum: TaskStatus })
  @Column({ type: 'varchar', length: 16, default: TaskStatus.Todo })
  status!: TaskStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
