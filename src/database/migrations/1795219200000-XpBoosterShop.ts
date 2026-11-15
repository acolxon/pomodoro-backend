import { MigrationInterface, QueryRunner } from 'typeorm';

export class XpBoosterShop1795219200000 implements MigrationInterface {
  name = 'XpBoosterShop1795219200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE xp_booster_inventory (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE shop_purchases (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id uuid NOT NULL,
      item_code varchar(32) NOT NULL CHECK (item_code = 'xp_booster'),
      price integer NOT NULL CHECK (price > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, request_id)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE shop_purchases');
    await queryRunner.query('DROP TABLE xp_booster_inventory');
  }
}
