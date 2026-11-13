import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/utils/transformers';

export class LoginDto {
  @ApiProperty({ example: 'alice_01', description: 'Email или имя пользователя' })
  @Transform(trimString)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  login!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
