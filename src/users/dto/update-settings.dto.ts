import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { IsTimeZoneName } from '../../common/validators/is-time-zone-name.decorator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Разрешить получение «пакостей»', example: false })
  @IsOptional()
  @IsBoolean()
  allowPranks?: boolean;

  @ApiPropertyOptional({ description: 'IANA-часовой пояс', example: 'Asia/Almaty' })
  @IsOptional()
  @IsTimeZoneName()
  timezone?: string;
}
