import { ApiProperty } from '@nestjs/swagger';

export class HistoryStatsDto {
  @ApiProperty({ example: 18 })
  totalSessions!: number;

  @ApiProperty({ example: 15 })
  completedSessions!: number;

  @ApiProperty({ example: 3 })
  cancelledSessions!: number;

  @ApiProperty({ example: 22500 })
  totalFocusedSeconds!: number;

  @ApiProperty({ example: 375 })
  totalFocusedMinutes!: number;

  @ApiProperty({ example: 1500 })
  averageFocusedSeconds!: number;
}
