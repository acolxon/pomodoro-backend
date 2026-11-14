import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/utils/transformers';

export class CreateTaskDto {
  @ApiProperty({ example: 'Finish backend API', minLength: 1, maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ example: 'Implement tasks and history endpoints', maxLength: 5000 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  description?: string;
}
