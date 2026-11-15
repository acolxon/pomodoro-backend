import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { UsersModule } from '../users/users.module';
import { PomodoroSession } from './entities/pomodoro-session.entity';
import { PomodoroService } from './pomodoro.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { HistoryModule } from '../history/history.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PomodoroSession]),
    AuthModule,
    UsersModule,
    RoomsModule,
    HistoryModule,
    TasksModule,
  ],
  providers: [PomodoroService, RealtimeGateway],
  exports: [PomodoroService],
})
export class PomodoroModule {}
