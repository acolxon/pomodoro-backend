import { PickType } from '@nestjs/swagger';
import { HistoryQueryDto } from './history-query.dto';

export class HistoryStatsQueryDto extends PickType(HistoryQueryDto, [
  'status',
  'from',
  'to',
] as const) {}
