import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user';
import { ShopService } from './shop.service';

class PurchaseDto {
  @IsUUID('4') requestId!: string;
}

@ApiTags('shop')
@ApiBearerAuth('access-token')
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}
  @Get()
  @ApiOperation({ summary: 'Текущий баланс и улучшение опыта' })
  get(@CurrentUser() user: AuthUser) {
    return this.shop.getShop(user.id);
  }

  @Post('xp-booster')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Купить усилитель XP с идемпотентным requestId' })
  buy(@CurrentUser() user: AuthUser, @Body() body: PurchaseDto) {
    return this.shop.buyXpBooster(user.id, body.requestId);
  }
}
