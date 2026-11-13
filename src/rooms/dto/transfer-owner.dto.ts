import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TransferOwnerDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id активного участника комнаты, который станет владельцем',
  })
  @IsUUID()
  newOwnerId!: string;
}
