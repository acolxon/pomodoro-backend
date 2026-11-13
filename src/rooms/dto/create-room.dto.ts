import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trimString } from '../../common/utils/transformers';

export const ROOM_NAME_MAX_LENGTH = 50;
export const ROOM_MIN_MEMBERS = 2;
export const ROOM_MAX_MEMBERS = 50;
export const ROOM_DEFAULT_MAX_MEMBERS = 10;

export class CreateRoomDto {
  @ApiProperty({ example: 'Deep Work', minLength: 1, maxLength: ROOM_NAME_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROOM_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    description: 'Максимум участников (включая владельца)',
    minimum: ROOM_MIN_MEMBERS,
    maximum: ROOM_MAX_MEMBERS,
    default: ROOM_DEFAULT_MAX_MEMBERS,
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(ROOM_MIN_MEMBERS)
  @Max(ROOM_MAX_MEMBERS)
  maxMembers?: number;
}
