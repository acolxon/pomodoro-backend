import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Этап 2 (Rooms): комнаты и история участия в них.
 *
 * Ключевые гарантии целостности на уровне PostgreSQL (сервисы лишь дают понятные ошибки):
 *  - invite_code уникален и имеет фиксированный формат;
 *  - пользователь может иметь НЕ БОЛЕЕ одного активного участия (left_at IS NULL) в любых комнатах;
 *  - в комнате не более одного активного владельца;
 *  - отложенный (на COMMIT) constraint-триггер проверяет инварианты, которые нельзя выразить
 *    обычными CHECK/UNIQUE:
 *      1. активных участников не больше max_members;
 *      2. у открытой комнаты owner_id совпадает с её активным участником в роли owner;
 *      3. в закрытой комнате нет активных участников.
 *    Проверка отложена, поэтому сервис может менять строки в любом порядке внутри транзакции.
 *    Для защиты от гонок триггер берёт FOR NO KEY UPDATE на строку комнаты
 *    (он не конфликтует с FOR KEY SHARE от внешних ключей, поэтому взаимных блокировок нет).
 *
 * Функции создаются через CREATE OR REPLACE, потому что TypeORM dropDatabase()
 * (используется в e2e) удаляет таблицы, но не функции.
 */
export class Rooms1794700800000 implements MigrationInterface {
  name = 'Rooms1794700800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // rooms ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "owner_id"    uuid          NOT NULL,
        "name"        varchar(50)   NOT NULL,
        "invite_code" varchar(8)    NOT NULL,
        "max_members" integer       NOT NULL DEFAULT 10,
        "status"      varchar(16)   NOT NULL DEFAULT 'open',
        "created_at"  timestamptz   NOT NULL DEFAULT now(),
        "updated_at"  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_rooms" PRIMARY KEY ("id"),
        -- Удаление владельца удаляет его комнату (владельца без пользователя быть не может)
        CONSTRAINT "fk_rooms_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_rooms_name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 50),
        -- Алфавит без похожих символов (нет I и O, нет 0 и 1)
        CONSTRAINT "ck_rooms_invite_code_format" CHECK ("invite_code" ~ '^[A-HJ-NP-Z2-9]{8}$'),
        CONSTRAINT "ck_rooms_max_members" CHECK ("max_members" BETWEEN 2 AND 50),
        CONSTRAINT "ck_rooms_status" CHECK ("status" IN ('open', 'closed'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_rooms_invite_code" ON "rooms" ("invite_code")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_rooms_owner" ON "rooms" ("owner_id")`);

    // room_members --------------------------------------------------------
    // Одна строка = одно участие. Повторный вход создаёт НОВУЮ строку, история сохраняется.
    await queryRunner.query(`
      CREATE TABLE "room_members" (
        "id"        uuid         NOT NULL DEFAULT gen_random_uuid(),
        "room_id"   uuid         NOT NULL,
        "user_id"   uuid         NOT NULL,
        "role"      varchar(16)  NOT NULL DEFAULT 'member',
        -- clock_timestamp(), а не now(): время вступления должно отражать реальный порядок
        -- (now() внутри транзакции постоянно), от него зависит выбор следующего владельца
        "joined_at" timestamptz  NOT NULL DEFAULT clock_timestamp(),
        "left_at"   timestamptz,
        CONSTRAINT "pk_room_members" PRIMARY KEY ("id"),
        CONSTRAINT "fk_room_members_room" FOREIGN KEY ("room_id")
          REFERENCES "rooms" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_room_members_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_room_members_role" CHECK ("role" IN ('owner', 'member')),
        CONSTRAINT "ck_room_members_left_after_joined" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at")
      )
    `);
    // Не более одного активного участия пользователя во всех комнатах сразу
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_room_members_active_user" ON "room_members" ("user_id") WHERE "left_at" IS NULL`,
    );
    // Не более одного активного владельца в комнате
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_room_members_active_owner" ON "room_members" ("room_id")
         WHERE "role" = 'owner' AND "left_at" IS NULL`,
    );
    // Список участников и поиск самого раннего активного участника
    await queryRunner.query(
      `CREATE INDEX "idx_room_members_room_active" ON "room_members" ("room_id", "joined_at", "id")
         WHERE "left_at" IS NULL`,
    );
    // История участий пользователя
    await queryRunner.query(
      `CREATE INDEX "idx_room_members_user_joined" ON "room_members" ("user_id", "joined_at" DESC)`,
    );

    // updated_at ----------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rooms_set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW."updated_at" := now();
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_rooms_updated_at" BEFORE UPDATE ON "rooms"
      FOR EACH ROW EXECUTE FUNCTION rooms_set_updated_at()
    `);

    // Инварианты комнаты (проверяются на COMMIT) --------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rooms_assert_integrity(p_room_id uuid) RETURNS void
      LANGUAGE plpgsql AS $$
      DECLARE
        v_room   rooms%ROWTYPE;
        v_active integer;
      BEGIN
        -- Сериализует одновременные фиксации изменений одной комнаты
        SELECT * INTO v_room FROM "rooms" WHERE "id" = p_room_id FOR NO KEY UPDATE;
        IF NOT FOUND THEN
          RETURN; -- комната удалена (каскад) — проверять нечего
        END IF;

        SELECT count(*) INTO v_active
          FROM "room_members" WHERE "room_id" = p_room_id AND "left_at" IS NULL;

        IF v_active > v_room.max_members THEN
          RAISE EXCEPTION 'Room % has % active members, max_members is %',
            p_room_id, v_active, v_room.max_members
            USING ERRCODE = '23514', CONSTRAINT = 'ck_room_capacity';
        END IF;

        IF v_room.status = 'closed' THEN
          IF v_active > 0 THEN
            RAISE EXCEPTION 'Closed room % still has % active members', p_room_id, v_active
              USING ERRCODE = '23514', CONSTRAINT = 'ck_room_closed_empty';
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM "room_members"
           WHERE "room_id" = p_room_id
             AND "user_id" = v_room.owner_id
             AND "role" = 'owner'
             AND "left_at" IS NULL
        ) THEN
          RAISE EXCEPTION 'Open room % owner % is not its active owner member', p_room_id, v_room.owner_id
            USING ERRCODE = '23514', CONSTRAINT = 'ck_room_owner_is_member';
        END IF;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rooms_integrity_trigger() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'rooms' THEN
          PERFORM rooms_assert_integrity(NEW."id");
        ELSIF TG_OP = 'DELETE' THEN
          PERFORM rooms_assert_integrity(OLD."room_id");
        ELSE
          PERFORM rooms_assert_integrity(NEW."room_id");
          IF TG_OP = 'UPDATE' AND OLD."room_id" <> NEW."room_id" THEN
            PERFORM rooms_assert_integrity(OLD."room_id");
          END IF;
        END IF;
        RETURN NULL;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "ctrg_rooms_integrity"
      AFTER INSERT OR UPDATE ON "rooms"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION rooms_integrity_trigger()
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "ctrg_room_members_integrity"
      AFTER INSERT OR UPDATE OR DELETE ON "room_members"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION rooms_integrity_trigger()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "ctrg_room_members_integrity" ON "room_members"`);
    await queryRunner.query(`DROP TRIGGER "ctrg_rooms_integrity" ON "rooms"`);
    await queryRunner.query(`DROP TRIGGER "trg_rooms_updated_at" ON "rooms"`);
    await queryRunner.query(`DROP FUNCTION rooms_integrity_trigger()`);
    await queryRunner.query(`DROP FUNCTION rooms_assert_integrity(uuid)`);
    await queryRunner.query(`DROP FUNCTION rooms_set_updated_at()`);

    await queryRunner.query(`DROP INDEX "idx_room_members_user_joined"`);
    await queryRunner.query(`DROP INDEX "idx_room_members_room_active"`);
    await queryRunner.query(`DROP INDEX "uq_room_members_active_owner"`);
    await queryRunner.query(`DROP INDEX "uq_room_members_active_user"`);
    await queryRunner.query(`DROP TABLE "room_members"`);

    await queryRunner.query(`DROP INDEX "idx_rooms_owner"`);
    await queryRunner.query(`DROP INDEX "uq_rooms_invite_code"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
  }
}
