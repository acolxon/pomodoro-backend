import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trimLowerCase, trimString } from '../../common/utils/transformers';

export class RegisterDto {
  @ApiProperty({
    example: 'alice_01',
    description: '3–20 символов: латинские буквы, цифры, подчёркивание. Регистр не различается при проверке уникальности.',
  })
  @Transform(trimString)
  @IsString()
  @Matches(/^[A-Za-z0-9_]{3,20}$/, {
    message: 'username must be 3-20 characters: latin letters, digits and underscore',
  })
  username!: string;

  @ApiProperty({ example: 'alice@example.com' })
  @Transform(trimLowerCase)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
