import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ROOM_DEFAULT_MAX_MEMBERS, CreateRoomDto } from './dto/create-room.dto';
import { LeaveRoomResultDto, RoomDto, RoomMemberDto } from './dto/room.dto';
import { RoomMember, RoomMemberRole } from './entities/room-member.entity';
import { Room, RoomStatus } from './entities/room.entity';
import { generateInviteCode, isValidInviteCode, normalizeInviteCode } from './invite-code';
import { isInviteCodeCollision, mapRoomDbError, roomErrors } from './rooms.errors';
import { toRoomDto, toRoomMemberDto } from './rooms.mapper';
import { HistoryService } from '../history/history.service';

/** Сколько раз пробуем создать комнату при (крайне маловероятной) коллизии invite_code. */
const INVITE_CODE_ATTEMPTS = 5;

/**
 * Правила конкурентности:
 *  - любое изменение комнаты выполняется в транзакции и начинается с SELECT ... FOR UPDATE
 *    строки комнаты: операции над одной комнатой выстраиваются в очередь (единый порядок
 *    блокировок исключает взаимные блокировки);
 *  - «один пользователь — одна активная комната» и «один владелец» гарантируют частичные
 *    уникальные индексы, вместимость и согласованность владельца — отложенный триггер БД.
 *    Проверки в сервисе нужны ради понятных ответов; при гонке ошибка БД
 *    превращается в тот же доменный код (см. mapRoomDbError).
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly history: HistoryService,
  ) {}

  /** Создаёт комнату; создатель становится её владельцем и первым участником. */
  async createRoom(userId: string, dto: CreateRoomDto): Promise<RoomDto> {
    for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const room = await manager.save(
            manager.create(Room, {
              ownerId: userId,
              name: dto.name,
              inviteCode: generateInviteCode(),
              maxMembers: dto.maxMembers ?? ROOM_DEFAULT_MAX_MEMBERS,
              status: RoomStatus.Open,
            }),
          );
          await manager.insert(RoomMember, {
            roomId: room.id,
            userId,
            role: RoomMemberRole.Owner,
          });
          return toRoomDto(room, 1);
        });
      } catch (error) {
        if (isInviteCodeCollision(error) && attempt < INVITE_CODE_ATTEMPTS) {
          continue;
        }
        throw mapRoomDbError(error) ?? error;
      }
    }
    // Недостижимо: последняя попытка всегда выходит через return или throw выше.
    throw new Error('Не удалось сгенерировать уникальный код приглашения');
  }

  /** Вступление по коду приглашения. */
  async joinRoom(userId: string, rawInviteCode: string): Promise<RoomDto> {
    const inviteCode = normalizeInviteCode(rawInviteCode);
    if (!isValidInviteCode(inviteCode)) {
      throw roomErrors.invalidInviteCode();
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const room = await manager
          .createQueryBuilder(Room, 'r')
          .setLock('pessimistic_write')
          .where('r.inviteCode = :inviteCode', { inviteCode })
          .getOne();
        if (!room) {
          throw roomErrors.invalidInviteCode();
        }
        if (room.status === RoomStatus.Closed) {
          throw roomErrors.closed();
        }
        if (await this.findActiveMembership(manager, userId)) {
          throw roomErrors.alreadyInRoom();
        }
        const activeCount = await this.countActiveMembers(manager, room.id);
        if (activeCount >= room.maxMembers) {
          throw roomErrors.full();
        }

        await manager.insert(RoomMember, {
          roomId: room.id,
          userId,
          role: RoomMemberRole.Member,
        });
        return toRoomDto(room, activeCount + 1);
      });
    } catch (error) {
      throw mapRoomDbError(error) ?? error;
    }
  }

  /**
   * Выход из текущей комнаты. Если выходит владелец, права переходят самому раннему
   * из оставшихся активных участников; если никого не осталось — комната закрывается.
   */
  async leaveRoom(userId: string): Promise<LeaveRoomResultDto> {
    const current = await this.findActiveMembership(this.dataSource.manager, userId);
    if (!current) {
      throw roomErrors.notInAnyRoom();
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const room = await manager
          .createQueryBuilder(Room, 'r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: current.roomId })
          .getOne();
        if (!room) {
          throw roomErrors.notInAnyRoom();
        }

        // Перечитываем под блокировкой: параллельный «выход» мог уже отработать
        const membership = await manager.findOne(RoomMember, {
          where: { roomId: room.id, userId, leftAt: IsNull() },
        });
        if (!membership) {
          throw roomErrors.notInAnyRoom();
        }

        const departure = await manager
          .createQueryBuilder()
          .update(RoomMember)
          .set({ leftAt: () => 'clock_timestamp()' })
          .where('id = :id', { id: membership.id })
          .returning('left_at')
          .execute();
        const leftAt = departure.raw[0].left_at as Date;
        await this.history.memberLeft(manager, room.id, userId, leftAt);

        if (membership.role !== RoomMemberRole.Owner) {
          return { roomId: room.id, roomClosed: false, newOwnerId: null };
        }

        const successor = await manager.findOne(RoomMember, {
          where: { roomId: room.id, leftAt: IsNull() },
          order: { joinedAt: 'ASC', id: 'ASC' },
        });
        if (!successor) {
          await manager.update(Room, { id: room.id }, { status: RoomStatus.Closed });
          await this.history.closeRoomFocus(manager, room.id, leftAt);
          return { roomId: room.id, roomClosed: true, newOwnerId: null };
        }

        await manager.update(RoomMember, { id: successor.id }, { role: RoomMemberRole.Owner });
        await manager.update(Room, { id: room.id }, { ownerId: successor.userId });
        return { roomId: room.id, roomClosed: false, newOwnerId: successor.userId };
      });
    } catch (error) {
      throw mapRoomDbError(error) ?? error;
    }
  }

  /** Текущая (единственная активная) комната пользователя. */
  async getMyRoom(userId: string): Promise<RoomDto> {
    const manager = this.dataSource.manager;
    const membership = await this.findActiveMembership(manager, userId);
    if (!membership) {
      throw roomErrors.notInAnyRoom();
    }
    const room = await manager.findOneBy(Room, { id: membership.roomId });
    if (!room) {
      throw roomErrors.notInAnyRoom();
    }
    return toRoomDto(room, await this.countActiveMembers(manager, room.id));
  }

  /** Информация о комнате (включая invite_code) — только для её активных участников. */
  async getRoom(userId: string, roomId: string): Promise<RoomDto> {
    const manager = this.dataSource.manager;
    const room = await this.getRoomForMember(manager, userId, roomId);
    return toRoomDto(room, await this.countActiveMembers(manager, room.id));
  }

  /** Активные участники комнаты в порядке вступления. */
  async getMembers(userId: string, roomId: string): Promise<RoomMemberDto[]> {
    const manager = this.dataSource.manager;
    await this.getRoomForMember(manager, userId, roomId);
    const members = await manager.find(RoomMember, {
      where: { roomId, leftAt: IsNull() },
      relations: { user: { stats: true } },
      order: { joinedAt: 'ASC', id: 'ASC' },
    });
    return members.map(toRoomMemberDto);
  }

  /** Передача прав владельца другому активному участнику. Доступна только владельцу. */
  async transferOwnership(userId: string, roomId: string, newOwnerId: string): Promise<RoomDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const room = await manager
          .createQueryBuilder(Room, 'r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: roomId })
          .getOne();
        if (!room) {
          throw roomErrors.notFound();
        }
        if (room.status === RoomStatus.Closed) {
          throw roomErrors.closed();
        }
        if (room.ownerId !== userId) {
          throw roomErrors.notOwner();
        }
        if (newOwnerId === userId) {
          throw roomErrors.alreadyOwner();
        }

        const target = await manager.findOne(RoomMember, {
          where: { roomId, userId: newOwnerId, leftAt: IsNull() },
        });
        if (!target) {
          throw roomErrors.memberNotFound();
        }
        const current = await manager.findOne(RoomMember, {
          where: { roomId, userId, leftAt: IsNull() },
        });
        if (!current) {
          // Недостижимо при целостной БД: владелец открытой комнаты — её активный участник
          throw roomErrors.notOwner();
        }

        // Сначала снимаем роль: частичный уникальный индекс допускает только одного активного владельца
        await manager.update(RoomMember, { id: current.id }, { role: RoomMemberRole.Member });
        await manager.update(RoomMember, { id: target.id }, { role: RoomMemberRole.Owner });
        await manager.update(Room, { id: roomId }, { ownerId: newOwnerId });

        const updated = await manager.findOneByOrFail(Room, { id: roomId });
        return toRoomDto(updated, await this.countActiveMembers(manager, roomId));
      });
    } catch (error) {
      throw mapRoomDbError(error) ?? error;
    }
  }

  // ---------------------------------------------------------------------------

  private findActiveMembership(manager: EntityManager, userId: string): Promise<RoomMember | null> {
    return manager.findOne(RoomMember, { where: { userId, leftAt: IsNull() } });
  }

  private countActiveMembers(manager: EntityManager, roomId: string): Promise<number> {
    return manager.count(RoomMember, { where: { roomId, leftAt: IsNull() } });
  }

  /** Комната должна существовать, а пользователь — быть её активным участником. */
  private async getRoomForMember(
    manager: EntityManager,
    userId: string,
    roomId: string,
  ): Promise<Room> {
    const room = await manager.findOneBy(Room, { id: roomId });
    if (!room) {
      throw roomErrors.notFound();
    }
    const membership = await manager.findOne(RoomMember, {
      where: { roomId, userId, leftAt: IsNull() },
    });
    if (!membership) {
      throw roomErrors.notMemberOfRoom();
    }
    return room;
  }
}
