import { DataSource } from 'typeorm';
import { PomodoroService } from '../../src/pomodoro/pomodoro.service';

/** Prepare old timer/history scenarios under the explicit readiness contract. */
export async function readyRoom(
  ds: DataSource,
  timer: PomodoroService,
  roomId: string,
): Promise<void> {
  const [session] = await ds.query('SELECT status FROM pomodoro_sessions WHERE room_id = $1', [
    roomId,
  ]);
  if (session && session.status !== 'idle') return;
  const members: Array<{ user_id: string }> = await ds.query(
    'SELECT user_id FROM room_members WHERE room_id = $1 AND left_at IS NULL ORDER BY user_id',
    [roomId],
  );
  for (const { user_id: userId } of members) {
    await ds.query(
      `INSERT INTO tasks (user_id, title, status)
      SELECT $1, 'Test focus', 'in_progress' WHERE NOT EXISTS
      (SELECT 1 FROM tasks WHERE user_id = $1 AND status = 'in_progress')`,
      [userId],
    );
    await timer.setReady(userId, roomId, true);
  }
}
