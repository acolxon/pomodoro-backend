import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { uuidPipe } from '../common/pipes/uuid.pipe';
import { HistoryQueryDto } from './dto/history-query.dto';
import { HistoryStatsQueryDto } from './dto/history-stats-query.dto';
import { HistoryStatsDto } from './dto/history-stats.dto';
import { HistoryPageDto } from './dto/history-page.dto';
import { FocusHistory } from './entities/focus-history.entity';
import { HistoryService } from './history.service';
import { HistoryRoomDto } from './dto/history-room.dto';

@ApiTags('history')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'UNAUTHORIZED — нет или недействителен JWT' })
@ApiBadRequestResponse({ description: 'VALIDATION_ERROR или BAD_REQUEST' })
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('sessions/:id/my-task')
  @ApiOperation({ summary: 'Личная задача, сохранённая при старте фокуса' })
  getSessionTask(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string) {
    return this.history.getSessionTask(user.id, id);
  }

  @Get('sessions/:id/results')
  @ApiOperation({ summary: 'Итоги завершённой сессии для её участников' })
  getSessionResults(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string) {
    return this.history.getSessionResults(user.id, id);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Комнаты из личной истории для фильтрации' })
  @ApiOkResponse({ type: [HistoryRoomDto] })
  getRooms(@CurrentUser() user: AuthUser): Promise<HistoryRoomDto[]> {
    return this.history.getRooms(user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Статистика личных фокус-сессий за период' })
  @ApiOkResponse({ type: HistoryStatsDto })
  getStats(
    @CurrentUser() user: AuthUser,
    @Query() query: HistoryStatsQueryDto,
  ): Promise<HistoryStatsDto> {
    return this.history.getStats(user.id, query);
  }

  @Get()
  @ApiOperation({ summary: 'История завершённых и отменённых фокус-сессий' })
  @ApiOkResponse({ type: HistoryPageDto })
  findAll(@CurrentUser() user: AuthUser, @Query() query: HistoryQueryDto): Promise<HistoryPageDto> {
    return this.history.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Одна запись личной истории' })
  @ApiOkResponse({ type: FocusHistory })
  @ApiNotFoundResponse({ description: 'HISTORY_NOT_FOUND' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string): Promise<FocusHistory> {
    return this.history.findOne(user.id, id);
  }
}
