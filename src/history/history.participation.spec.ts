import { EntityManager, Repository } from 'typeorm';
import { FocusHistory } from './entities/focus-history.entity';
import { PomodoroParticipant } from './entities/pomodoro-participant.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomMember } from '../rooms/entities/room-member.entity';
import { Task } from '../tasks/entities/task.entity';
import { ProgressionService } from '../progression/progression.service';
import { HistoryService } from './history.service';

describe('Focus participation start', () => {
  const service = new HistoryService({} as Repository<FocusHistory>, {} as ProgressionService);
  let members: Array<{ userId: string; ready: boolean }>;
  let tasks: Array<{ userId: string; id: string; title: string }>;
  let manager: EntityManager;
  beforeEach(() => {
    members = [
      { userId: 'a', ready: true },
      { userId: 'b', ready: true },
    ];
    tasks = [
      { userId: 'a', id: 'ta', title: 'First' },
      { userId: 'b', id: 'tb', title: 'Second' },
    ];
    manager = {
      findOneByOrFail: jest.fn(async (entity) => (entity === Room ? { name: 'Room' } : null)),
      find: jest.fn(async (entity) =>
        entity === RoomMember ? members : entity === Task ? tasks : [],
      ),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'run' })),
      insert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    } as unknown as EntityManager;
  });
  it('rejects an unready participant before creating a run', async () => {
    members[1].ready = false;
    await expect(service.beginFocus(manager, 'room', new Date(), 1500)).rejects.toThrow(
      /готовность/,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('rejects a missing active task before creating a run', async () => {
    tasks.pop();
    await expect(service.beginFocus(manager, 'room', new Date(), 1500)).rejects.toThrow(/задачу/);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('snapshots each participant’s task and clears readiness in the same transaction', async () => {
    expect(await service.beginFocus(manager, 'room', new Date(), 1500)).toBe('run');
    expect(manager.insert).toHaveBeenCalledWith(PomodoroParticipant, [
      expect.objectContaining({ userId: 'a', taskId: 'ta', taskTitle: 'First' }),
      expect.objectContaining({ userId: 'b', taskId: 'tb', taskTitle: 'Second' }),
    ]);
    expect(manager.update).toHaveBeenCalledWith(
      RoomMember,
      expect.objectContaining({ roomId: 'room' }),
      { ready: false },
    );
  });
});
