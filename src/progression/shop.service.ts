import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserStats } from '../users/entities/user-stats.entity';
import { PROGRESSION_RULES } from './progression.rules';

export interface ShopState {
  coins: number;
  item: { code: 'xp_booster'; price: number; bonusPercent: number; quantity: number };
}

@Injectable()
export class ShopService {
  constructor(private readonly dataSource: DataSource) {}

  async getShop(userId: string): Promise<ShopState> {
    const rows: Array<{ coins: number; quantity: number }> = await this.dataSource.query(
      `SELECT s.coins, COALESCE(i.quantity, 0)::int AS quantity
       FROM user_stats s LEFT JOIN xp_booster_inventory i ON i.user_id = s.user_id
       WHERE s.user_id = $1`,
      [userId],
    );
    if (!rows.length) throw new Error('User stats missing');
    return this.state(rows[0].coins, rows[0].quantity);
  }

  async buyXpBooster(userId: string, requestId: string): Promise<ShopState> {
    return this.dataSource.transaction(async (manager) => {
      // The same lock is acquired by reward finalization before consuming a charge.
      const stats = await manager.findOneOrFail(UserStats, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      const existing: Array<{ request_id: string }> = await manager.query(
        'SELECT request_id FROM shop_purchases WHERE user_id = $1 AND request_id = $2',
        [userId, requestId],
      );
      if (!existing.length) {
        const price = PROGRESSION_RULES.xpBoosterPrice;
        if (stats.coins < price) throw new ConflictException('Недостаточно монет для покупки');
        await manager.query(
          `INSERT INTO shop_purchases (user_id, request_id, item_code, price) VALUES ($1, $2, 'xp_booster', $3)`,
          [userId, requestId, price],
        );
        await manager.query(
          `INSERT INTO xp_booster_inventory (user_id, quantity) VALUES ($1, 1)
           ON CONFLICT (user_id) DO UPDATE SET quantity = xp_booster_inventory.quantity + 1, updated_at = now()`,
          [userId],
        );
        stats.coins -= price;
        await manager.save(stats);
      }
      const inventory: Array<{ quantity: number }> = await manager.query(
        'SELECT quantity FROM xp_booster_inventory WHERE user_id = $1',
        [userId],
      );
      return this.state(stats.coins, inventory[0]?.quantity ?? 0);
    });
  }

  private state(coins: number, quantity: number): ShopState {
    return {
      coins,
      item: {
        code: 'xp_booster',
        price: PROGRESSION_RULES.xpBoosterPrice,
        bonusPercent: PROGRESSION_RULES.xpBoosterPercent,
        quantity,
      },
    };
  }
}
