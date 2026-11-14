import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FocusHistoryStatus } from '../entities/focus-history.entity';

export class HistoryQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Комната, в которой проходила сессия' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ enum: FocusHistoryStatus })
  @IsOptional()
  @IsEnum(FocusHistoryStatus)
  status?: FocusHistoryStatus;

  @ApiPropertyOptional({ format: 'date-time', description: 'Начало периода, включительно' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Конец периода, не включительно' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
