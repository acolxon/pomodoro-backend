import { MigrationInterface, QueryRunner } from 'typeorm';

/** Личные задачи, постоянные запуски Focus и история их участников. */
export class TasksAndHistory1794873600000 implements MigrationInterface {
  name = 'TasksAndHistory1794873600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"      uuid          NOT NULL,
        "title"        varchar(120)  NOT NULL,
        "description"  text,
        "status"       varchar(16)   NOT NULL DEFAULT 'todo',
        "created_at"   timestamptz   NOT NULL DEFAULT now(),
        "updated_at"   timestamptz   NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        CONSTRAINT "pk_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tasks_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_tasks_title" CHECK (char_length(btrim("title")) BETWEEN 1 AND 120),
        CONSTRAINT "ck_tasks_status" CHECK ("status" IN ('todo', 'in_progress', 'completed')),
        CONSTRAINT "ck_tasks_completed_at" CHECK (
          ("status" = 'completed' AND "completed_at" IS NOT NULL) OR
          ("status" <> 'completed' AND "completed_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_user_created" ON "tasks" ("user_id", "created_at" DESC)`,
    );
    // Один пользователь может иметь только одну задачу в статусе in_progress.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tasks_one_in_progress_per_user" ON "tasks" ("user_id") WHERE "status" = 'in_progress'`,
    );

    await queryRunner.query(`
      CREATE TABLE "pomodoro_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "room_id" uuid REFERENCES "rooms" ("id") ON DELETE SET NULL,
        "planned_duration_seconds" integer NOT NULL,
        "focused_milliseconds" integer NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'running',
        "started_at" timestamptz NOT NULL,
        "ended_at" timestamptz,
        CONSTRAINT "ck_pomodoro_run_duration" CHECK (
          "planned_duration_seconds" BETWEEN 1 AND 14400 AND
          "focused_milliseconds" BETWEEN 0 AND "planned_duration_seconds" * 1000
        ),
        CONSTRAINT "ck_pomodoro_run_status" CHECK (
          ("status" = 'running' AND "ended_at" IS NULL) OR
          ("status" IN ('completed', 'cancelled') AND "ended_at" IS NOT NULL AND "ended_at" >= "started_at")
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pomodoro_runs_room_active" ON "pomodoro_runs" ("room_id") WHERE "status" = 'running'
    `);
    await queryRunner.query(`
      CREATE TABLE "pomodoro_participants" (
        "run_id" uuid NOT NULL REFERENCES "pomodoro_runs" ("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "task_id" uuid REFERENCES "tasks" ("id") ON DELETE SET NULL,
        "task_title" varchar(120),
        "focused_milliseconds" integer NOT NULL DEFAULT 0 CHECK ("focused_milliseconds" >= 0),
        "finished_at" timestamptz,
        PRIMARY KEY ("run_id", "user_id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "pomodoro_sessions" ADD COLUMN "focus_run_id" uuid
        REFERENCES "pomodoro_runs" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "focus_history" (
        "id"                       uuid          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  uuid          NOT NULL,
        "task_id"                  uuid,
        "task_title"               varchar(120),
        "room_id"                  uuid,
        "pomodoro_session_id"      uuid          NOT NULL,
        "status"                   varchar(16)   NOT NULL,
        "planned_duration_seconds" integer       NOT NULL,
        "focused_seconds"           integer       NOT NULL,
        "started_at"                timestamptz   NOT NULL,
        "ended_at"                  timestamptz   NOT NULL,
        "created_at"                timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_focus_history" PRIMARY KEY ("id"),
        CONSTRAINT "fk_focus_history_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_focus_history_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_focus_history_room" FOREIGN KEY ("room_id")
          REFERENCES "rooms" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_focus_history_run" FOREIGN KEY ("pomodoro_session_id")
          REFERENCES "pomodoro_runs" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_focus_history_user_session" UNIQUE ("user_id", "pomodoro_session_id"),
        CONSTRAINT "ck_focus_history_status" CHECK ("status" IN ('completed', 'cancelled')),
        CONSTRAINT "ck_focus_history_planned" CHECK ("planned_duration_seconds" BETWEEN 1 AND 14400),
        CONSTRAINT "ck_focus_history_focused" CHECK (
          "focused_seconds" BETWEEN 0 AND "planned_duration_seconds"
        ),
        CONSTRAINT "ck_focus_history_interval" CHECK ("ended_at" >= "started_at")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_focus_history_user_started" ON "focus_history" ("user_id", "started_at" DESC, "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_focus_history_task" ON "focus_history" ("task_id") WHERE "task_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_focus_history_pomodoro_session" ON "focus_history" ("pomodoro_session_id") WHERE "pomodoro_session_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pomodoro_sessions" DROP COLUMN "focus_run_id"`);
    await queryRunner.query(`DROP INDEX "idx_focus_history_pomodoro_session"`);
    await queryRunner.query(`DROP INDEX "idx_focus_history_task"`);
    await queryRunner.query(`DROP INDEX "idx_focus_history_user_started"`);
    await queryRunner.query(`DROP TABLE "focus_history"`);
    await queryRunner.query(`DROP TABLE "pomodoro_participants"`);
    await queryRunner.query(`DROP TABLE "pomodoro_runs"`);

    await queryRunner.query(`DROP INDEX "uq_tasks_one_in_progress_per_user"`);
    await queryRunner.query(`DROP INDEX "idx_tasks_user_created"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
  }
}
