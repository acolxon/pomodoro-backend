import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({
    description: 'Код приглашения (регистр и пробелы по краям не важны)',
    example: 'K7M2QX9P',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  inviteCode!: string;
}
