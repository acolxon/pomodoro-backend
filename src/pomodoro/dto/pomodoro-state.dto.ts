import { ApiProperty } from '@nestjs/swagger';
import { PomodoroPhase, PomodoroStatus } from '../entities/pomodoro-session.entity';

export class PomodoroStateDto {
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ enum: PomodoroStatus }) status!: PomodoroStatus;
  @ApiProperty({ enum: PomodoroPhase, nullable: true }) phase!: PomodoroPhase | null;
  @ApiProperty({ example: 1500 }) durationSeconds!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) pausedAt!: Date | null;
  @ApiProperty({ type: Number, nullable: true }) remainingSeconds!: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) serverTime!: Date;
}
