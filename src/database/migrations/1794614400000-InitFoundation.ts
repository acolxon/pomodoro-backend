import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Этап 1 (Foundation): пользователи, статистика и настройки.
 * Миграции пишутся вручную (SQL), чтобы индексы и ограничения были явными.
 */
export class InitFoundation1794614400000 implements MigrationInterface {
  name = 'InitFoundation1794614400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // users ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid          NOT NULL DEFAULT gen_random_uuid(),
        "username"      varchar(20)   NOT NULL,
        "email"         varchar(255)  NOT NULL,
        "password_hash" varchar(255)  NOT NULL,
        "avatar_url"    varchar(2048),
        "created_at"    timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "ck_users_username_format" CHECK ("username" ~ '^[A-Za-z0-9_]{3,20}$')
      )
    `);
    // Уникальность без учёта регистра (Alice и alice — один и тот же пользователь)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_username_lower" ON "users" (lower("username"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" (lower("email"))`,
    );

    // user_stats ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "user_stats" (
        "user_id"                   uuid         NOT NULL,
        "xp"                        integer      NOT NULL DEFAULT 0,
        "level"                     integer      NOT NULL DEFAULT 1,
        "coins"                     integer      NOT NULL DEFAULT 0,
        "sessions_completed"        integer      NOT NULL DEFAULT 0,
        "collab_sessions_completed" integer      NOT NULL DEFAULT 0,
        "active_days"               integer      NOT NULL DEFAULT 0,
        "last_active_date"          date,
        "updated_at"                timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_stats" PRIMARY KEY ("user_id"),
        CONSTRAINT "fk_user_stats_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_user_stats_xp" CHECK ("xp" >= 0),
        CONSTRAINT "ck_user_stats_level" CHECK ("level" >= 1),
        CONSTRAINT "ck_user_stats_coins" CHECK ("coins" >= 0),
        CONSTRAINT "ck_user_stats_counters" CHECK (
          "sessions_completed" >= 0 AND "collab_sessions_completed" >= 0 AND "active_days" >= 0
        )
      )
    `);
    // Для лидерборда
    await queryRunner.query(`CREATE INDEX "idx_user_stats_xp" ON "user_stats" ("xp" DESC)`);

    // user_settings -------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "user_settings" (
        "user_id"      uuid         NOT NULL,
        "allow_pranks" boolean      NOT NULL DEFAULT true,
        "timezone"     varchar(64)  NOT NULL DEFAULT 'UTC',
        CONSTRAINT "pk_user_settings" PRIMARY KEY ("user_id"),
        CONSTRAINT "fk_user_settings_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(`DROP INDEX "idx_user_stats_xp"`);
    await queryRunner.query(`DROP TABLE "user_stats"`);
    await queryRunner.query(`DROP INDEX "uq_users_email_lower"`);
    await queryRunner.query(`DROP INDEX "uq_users_username_lower"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
