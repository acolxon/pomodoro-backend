import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EconomyTransaction } from './entities/economy-transaction.entity';
import { ProgressionService } from './progression.service';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EconomyTransaction])],
  controllers: [ShopController],
  providers: [ProgressionService, ShopService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
