import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { uuidPipe } from '../common/pipes/uuid.pipe';
import { AuthUser } from '../auth/types/auth-user';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { PublicProfileDto, UserProfileDto } from './dto/user-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ВАЖНО: статические маршруты (me, позже leaderboard) объявляются ДО ':id'.

  @Get('me')
  @ApiOperation({ summary: 'Мой полный профиль (статистика и настройки)' })
  @ApiOkResponse({ type: UserProfileDto })
  getMe(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.users.getProfile(user.id);
  }

  @Patch('me/settings')
  @ApiOperation({ summary: 'Изменить мои настройки (пакости, часовой пояс)' })
  @ApiOkResponse({ type: UserProfileDto })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserProfileDto> {
    return this.users.updateSettings(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Публичный профиль пользователя (без email и Coins)' })
  @ApiOkResponse({ type: PublicProfileDto })
  getPublic(@Param('id', uuidPipe) id: string): Promise<PublicProfileDto> {
    return this.users.getPublicProfile(id);
  }
}
