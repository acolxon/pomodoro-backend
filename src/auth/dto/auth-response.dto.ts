import { ApiProperty } from '@nestjs/swagger';
import { UserProfileDto } from '../../users/dto/user-profile.dto';

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT. Передавать в заголовке Authorization: Bearer <token>' })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 604800, description: 'Срок жизни токена в секундах' })
  expiresIn!: number;

  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;
}
