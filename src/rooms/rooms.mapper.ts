import { RoomDto, RoomMemberDto } from './dto/room.dto';
import { RoomMember } from './entities/room-member.entity';
import { Room } from './entities/room.entity';

/** Сущность никогда не отдаётся клиенту напрямую — только через явные DTO. */
export function toRoomDto(room: Room, membersCount: number): RoomDto {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    inviteCode: room.inviteCode,
    maxMembers: room.maxMembers,
    membersCount,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

/** Требует загруженных связей member.user и member.user.stats. */
export function toRoomMemberDto(member: RoomMember): RoomMemberDto {
  if (!member.user) {
    throw new Error(`У участника ${member.id} не загружен пользователь`);
  }
  return {
    userId: member.userId,
    username: member.user.username,
    avatarUrl: member.user.avatarUrl,
    level: member.user.stats?.level ?? 1,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}
