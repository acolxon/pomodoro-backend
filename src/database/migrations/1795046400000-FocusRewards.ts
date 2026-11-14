import { MigrationInterface, QueryRunner } from 'typeorm';

export class FocusRewards1795046400000 implements MigrationInterface {
  name = 'FocusRewards1795046400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE economy_transactions (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_type varchar(24) NOT NULL,
        source_id uuid NOT NULL,
        xp integer NOT NULL,
        coins integer NOT NULL,
        team_bonus boolean NOT NULL,
        activity_date date NOT NULL,
        earned_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_economy_transactions PRIMARY KEY (id),
        CONSTRAINT uq_economy_source_user UNIQUE (source_type, source_id, user_id),
        CONSTRAINT ck_economy_source_type CHECK (source_type = 'focus_completed'),
        CONSTRAINT ck_economy_rewards CHECK (xp > 0 AND coins >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_economy_user_day ON economy_transactions(user_id, activity_date)`,
    );
    await queryRunner.query(`
      ALTER TABLE focus_history
        ADD COLUMN xp_earned integer NOT NULL DEFAULT 0,
        ADD COLUMN coins_earned integer NOT NULL DEFAULT 0,
        ADD COLUMN team_bonus boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT ck_history_rewards CHECK (xp_earned >= 0 AND coins_earned >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE focus_history DROP CONSTRAINT ck_history_rewards,
      DROP COLUMN team_bonus, DROP COLUMN coins_earned, DROP COLUMN xp_earned`);
    await queryRunner.query('DROP TABLE economy_transactions');
  }
}
