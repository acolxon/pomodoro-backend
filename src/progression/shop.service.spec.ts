import { DataSource, EntityManager } from 'typeorm';
import { UserStats } from '../users/entities/user-stats.entity';
import { ShopService } from './shop.service';

describe('XP booster purchases', () => {
  let service: ShopService;
  let stats: UserStats;
  let quantity: number;
  let purchases: Set<string>;
  let manager: EntityManager;

  beforeEach(() => {
    stats = { userId: 'user', coins: 40 } as UserStats;
    quantity = 0;
    purchases = new Set();
    manager = {
      findOneOrFail: jest.fn(async () => stats),
      save: jest.fn(async (value) => value),
      query: jest.fn(async (sql: string, values: unknown[]) => {
        if (sql.startsWith('SELECT request_id'))
          return purchases.has(String(values[1])) ? [{ request_id: values[1] }] : [];
        if (sql.includes('INSERT INTO shop_purchases')) {
          purchases.add(String(values[1]));
          return [];
        }
        if (sql.includes('INSERT INTO xp_booster_inventory')) {
          quantity++;
          return [];
        }
        if (sql.startsWith('SELECT quantity')) return quantity ? [{ quantity }] : [];
        throw new Error('Unexpected query');
      }),
    } as unknown as EntityManager;
    service = new ShopService({
      transaction: (fn: (manager: EntityManager) => unknown) => fn(manager),
    } as DataSource);
  });

  it('spends coins and grants one charge under the stats lock', async () => {
    expect(await service.buyXpBooster('user', 'request')).toMatchObject({
      coins: 20,
      item: { price: 20, quantity: 1, bonusPercent: 10 },
    });
    expect(manager.findOneOrFail).toHaveBeenCalledWith(
      UserStats,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
  it('replays the same request without charging twice', async () => {
    await service.buyXpBooster('user', 'request');
    expect(await service.buyXpBooster('user', 'request')).toMatchObject({
      coins: 20,
      item: { quantity: 1 },
    });
    expect(purchases.size).toBe(1);
  });
  it('rejects insufficient funds without writing a purchase or inventory', async () => {
    stats.coins = 19;
    await expect(service.buyXpBooster('user', 'request')).rejects.toThrow(/Недостаточно монет/);
    expect(purchases.size).toBe(0);
    expect(quantity).toBe(0);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
