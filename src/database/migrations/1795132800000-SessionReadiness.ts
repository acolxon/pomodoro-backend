import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionReadiness1795132800000 implements MigrationInterface {
  name = 'SessionReadiness1795132800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE room_members ADD COLUMN ready boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE pomodoro_participants ADD COLUMN finish_reason varchar(24), ADD CONSTRAINT ck_participant_finish_reason CHECK (finish_reason IS NULL OR finish_reason IN ('completed', 'cancelled', 'left_focus', 'left_room'))`,
    );
    // Reject an already-inconsistent database rather than silently discarding an active participant.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_participant_active_user ON pomodoro_participants(user_id) WHERE finished_at IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX uq_participant_active_user`);
    await queryRunner.query(
      `ALTER TABLE pomodoro_participants DROP CONSTRAINT ck_participant_finish_reason, DROP COLUMN finish_reason`,
    );
    await queryRunner.query(`ALTER TABLE room_members DROP COLUMN ready`);
  }
}
