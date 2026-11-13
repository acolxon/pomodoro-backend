import { RoomMember, RoomMemberRole } from './entities/room-member.entity';
import { Room, RoomStatus } from './entities/room.entity';
import { toRoomDto, toRoomMemberDto } from './rooms.mapper';
import { User } from '../users/entities/user.entity';
import { UserStats } from '../users/entities/user-stats.entity';

describe('rooms.mapper', () => {
  const now = new Date('2026-11-14T10:00:00Z');

  it('toRoomDto отдаёт только публичные поля комнаты', () => {
    const room = Object.assign(new Room(), {
      id: 'r1',
      ownerId: 'u1',
      name: 'Focus',
      inviteCode: 'K7M2QX9P',
      maxMembers: 5,
      status: RoomStatus.Open,
      createdAt: now,
      updatedAt: now,
    });
    expect(toRoomDto(room, 3)).toEqual({
      id: 'r1',
      name: 'Focus',
      ownerId: 'u1',
      inviteCode: 'K7M2QX9P',
      maxMembers: 5,
      membersCount: 3,
      status: RoomStatus.Open,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('toRoomMemberDto не раскрывает email, Coins и прочие данные пользователя', () => {
    const user = Object.assign(new User(), {
      id: 'u2',
      username: 'bob_02',
      email: 'bob@example.com',
      avatarUrl: null,
      stats: Object.assign(new UserStats(), { level: 4, coins: 999, xp: 10 }),
    });
    const member = Object.assign(new RoomMember(), {
      id: 'm1',
      roomId: 'r1',
      userId: 'u2',
      role: RoomMemberRole.Member,
      joinedAt: now,
      leftAt: null,
      user,
    });

    const dto = toRoomMemberDto(member);
    expect(dto).toEqual({
      userId: 'u2',
      username: 'bob_02',
      avatarUrl: null,
      level: 4,
      role: RoomMemberRole.Member,
      joinedAt: now,
    });
    expect(JSON.stringify(dto)).not.toContain('bob@example.com');
    expect(JSON.stringify(dto)).not.toContain('999');
  });

  it('toRoomMemberDto: без статистики уровень = 1', () => {
    const member = Object.assign(new RoomMember(), {
      id: 'm1',
      userId: 'u2',
      role: RoomMemberRole.Owner,
      joinedAt: now,
      user: Object.assign(new User(), { username: 'bob_02', avatarUrl: null }),
    });
    expect(toRoomMemberDto(member).level).toBe(1);
  });

  it('toRoomMemberDto: без загруженного пользователя — явная ошибка, а не пустые поля', () => {
    const member = Object.assign(new RoomMember(), { id: 'm1', userId: 'u2' });
    expect(() => toRoomMemberDto(member)).toThrow(/не загружен пользователь/);
  });
});
