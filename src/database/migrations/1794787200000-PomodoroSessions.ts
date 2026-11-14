import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persisted shared Pomodoro state: one row per room. */
export class PomodoroSessions1794787200000 implements MigrationInterface {
  name = 'PomodoroSessions1794787200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pomodoro_sessions" (
        "room_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'idle',
        "phase" varchar(16),
        "duration_seconds" integer NOT NULL DEFAULT 1500,
        "started_at" timestamptz,
        "ends_at" timestamptz,
        "paused_at" timestamptz,
        "remaining_seconds" integer,
        "updated_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_pomodoro_sessions" PRIMARY KEY ("room_id"),
        CONSTRAINT "fk_pomodoro_sessions_room" FOREIGN KEY ("room_id")
          REFERENCES "rooms" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pomodoro_sessions_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "ck_pomodoro_status" CHECK ("status" IN ('idle', 'running', 'paused')),
        CONSTRAINT "ck_pomodoro_phase" CHECK ("phase" IS NULL OR "phase" IN ('focus', 'break')),
        CONSTRAINT "ck_pomodoro_duration" CHECK ("duration_seconds" IN (300, 1500)),
        CONSTRAINT "ck_pomodoro_remaining" CHECK ("remaining_seconds" IS NULL OR "remaining_seconds" BETWEEN 0 AND 1500),
        CONSTRAINT "ck_pomodoro_state" CHECK (
          ("status" = 'idle' AND "phase" IS NULL AND "started_at" IS NULL AND "ends_at" IS NULL AND "paused_at" IS NULL AND "remaining_seconds" IS NULL)
          OR ("status" = 'running' AND "phase" IS NOT NULL AND "started_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "paused_at" IS NULL AND "remaining_seconds" IS NULL)
          OR ("status" = 'paused' AND "phase" IS NOT NULL AND "started_at" IS NULL AND "ends_at" IS NULL AND "paused_at" IS NOT NULL AND "remaining_seconds" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_pomodoro_running" ON "pomodoro_sessions" ("ends_at") WHERE "status" = 'running'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_pomodoro_running"`);
    await queryRunner.query(`DROP TABLE "pomodoro_sessions"`);
  }
}
