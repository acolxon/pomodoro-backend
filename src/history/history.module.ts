import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FocusHistory } from './entities/focus-history.entity';
import { PomodoroRun } from './entities/pomodoro-run.entity';
import { PomodoroParticipant } from './entities/pomodoro-participant.entity';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { ProgressionModule } from '../progression/progression.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FocusHistory, PomodoroRun, PomodoroParticipant]),
    ProgressionModule,
  ],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
