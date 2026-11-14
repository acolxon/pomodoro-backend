import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HistoryRoomDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true }) name!: string | null;
}
