import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryRoomNames1794960000000 implements MigrationInterface {
  name = 'HistoryRoomNames1794960000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pomodoro_runs ADD COLUMN room_name varchar(50)`);
    await queryRunner.query(`ALTER TABLE focus_history ADD COLUMN room_name varchar(50)`);
    await queryRunner.query(
      `UPDATE pomodoro_runs p SET room_name = r.name FROM rooms r WHERE p.room_id = r.id`,
    );
    await queryRunner.query(
      `UPDATE focus_history h SET room_name = r.name FROM rooms r WHERE h.room_id = r.id`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_focus_history_user_room_started ON focus_history (user_id, room_id, started_at DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_focus_history_user_room_started`);
    await queryRunner.query(`ALTER TABLE focus_history DROP COLUMN room_name`);
    await queryRunner.query(`ALTER TABLE pomodoro_runs DROP COLUMN room_name`);
  }
}
