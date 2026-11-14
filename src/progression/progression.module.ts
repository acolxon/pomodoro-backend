import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EconomyTransaction } from './entities/economy-transaction.entity';
import { ProgressionService } from './progression.service';

@Module({
  imports: [TypeOrmModule.forFeature([EconomyTransaction])],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
