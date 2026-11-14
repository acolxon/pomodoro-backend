import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trimString } from '../../common/utils/transformers';
import { TaskStatus } from '../entities/task.entity';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Finish backend API', minLength: 1, maxLength: 120 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 'Add validation and e2e tests', maxLength: 5000, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskStatus, example: TaskStatus.InProgress })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}
