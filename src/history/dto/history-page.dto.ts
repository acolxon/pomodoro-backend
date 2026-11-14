import { ApiProperty } from '@nestjs/swagger';
import { FocusHistory } from '../entities/focus-history.entity';

export class HistoryPageDto {
  @ApiProperty({ type: [FocusHistory] }) items!: FocusHistory[];
  @ApiProperty({ example: 20 }) total!: number;
}
