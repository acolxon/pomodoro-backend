import { DataSource } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RoomDto } from './dto/room.dto';
import { RoomStatus } from './entities/room.entity';
import { RoomsService } from './rooms.service';
import { HistoryService } from '../history/history.service';

/**
 * Unit-тесты ветвлений, не требующих БД: ранние отказы и поведение при ошибках БД.
 * Транзакционная логика (блокировки, передача владения, закрытие комнаты, гонки)
 * проверяется в test/rooms.e2e-spec.ts на настоящем PostgreSQL.
 */
describe('RoomsService (unit)', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000001';

  const roomDto: RoomDto = {
    id: 'room-1',
    name: 'Focus',
    ownerId: USER_ID,
    inviteCode: 'AAAAAAAA',
    maxMembers: 10,
    membersCount: 1,
    status: RoomStatus.Open,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const pgError = (code: string, constraint: string) => ({ driverError: { code, constraint } });

  function setup() {
    const manager = { findOne: jest.fn(), findOneBy: jest.fn(), count: jest.fn() };
    const transaction = jest.fn();
    const dataSource = { manager, transaction } as unknown as DataSource;
    const history = {
      memberLeft: jest.fn(),
      closeRoomFocus: jest.fn(),
    } as unknown as HistoryService;
    return { service: new RoomsService(dataSource, history), manager, transaction };
  }

  async function errorOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => null,
      (e: unknown) => e,
    );
  }

  const codeOf = (error: unknown): unknown =>
    ((error as AppException).getResponse() as { code: string }).code;

  describe('joinRoom', () => {
    it.each(['', '   ', 'short', 'AAAAAAA0', 'ILLEGALS', 'AAAA-AAA', 'A'.repeat(9)])(
      'некорректный код %j отклоняется без обращения к БД',
      async (code) => {
        const { service, transaction } = setup();
        const error = await errorOf(service.joinRoom(USER_ID, code));
        expect(codeOf(error)).toBe(ErrorCode.INVALID_INVITE_CODE);
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it('регистр и пробелы по краям не важны: код нормализуется перед поиском', async () => {
      const { service, transaction } = setup();
      transaction.mockResolvedValueOnce(roomDto);
      await service.joinRoom(USER_ID, '  aaaaaaaa ');
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('нарушение uq_room_members_active_user при гонке → ALREADY_IN_ROOM', async () => {
      const { service, transaction } = setup();
      transaction.mockRejectedValueOnce(pgError('23505', 'uq_room_members_active_user'));
      const error = await errorOf(service.joinRoom(USER_ID, 'AAAAAAAA'));
      expect(codeOf(error)).toBe(ErrorCode.ALREADY_IN_ROOM);
    });

    it('нарушение ck_room_capacity при гонке → ROOM_FULL', async () => {
      const { service, transaction } = setup();
      transaction.mockRejectedValueOnce(pgError('23514', 'ck_room_capacity'));
      const error = await errorOf(service.joinRoom(USER_ID, 'AAAAAAAA'));
      expect(codeOf(error)).toBe(ErrorCode.ROOM_FULL);
    });

    it('неизвестная ошибка БД не маскируется доменной', async () => {
      const { service, transaction } = setup();
      const boom = new Error('connection lost');
      transaction.mockRejectedValueOnce(boom);
      await expect(service.joinRoom(USER_ID, 'AAAAAAAA')).rejects.toBe(boom);
    });
  });

  describe('createRoom', () => {
    const collision = pgError('23505', 'uq_rooms_invite_code');

    it('при коллизии invite_code повторяет попытку с новым кодом', async () => {
      const { service, transaction } = setup();
      transaction
        .mockRejectedValueOnce(collision)
        .mockRejectedValueOnce(collision)
        .mockResolvedValueOnce(roomDto);

      await expect(service.createRoom(USER_ID, { name: 'Focus' })).resolves.toBe(roomDto);
      expect(transaction).toHaveBeenCalledTimes(3);
    });

    it('после 5 коллизий подряд сдаётся и пробрасывает исходную ошибку', async () => {
      const { service, transaction } = setup();
      transaction.mockRejectedValue(collision);

      await expect(service.createRoom(USER_ID, { name: 'Focus' })).rejects.toBe(collision);
      expect(transaction).toHaveBeenCalledTimes(5);
    });

    it('пользователь уже в комнате (uq_room_members_active_user) → ALREADY_IN_ROOM без повторов', async () => {
      const { service, transaction } = setup();
      transaction.mockRejectedValue(pgError('23505', 'uq_room_members_active_user'));

      const error = await errorOf(service.createRoom(USER_ID, { name: 'Focus' }));
      expect(codeOf(error)).toBe(ErrorCode.ALREADY_IN_ROOM);
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('неизвестная ошибка БД не повторяется и не маскируется', async () => {
      const { service, transaction } = setup();
      const boom = new Error('disk full');
      transaction.mockRejectedValue(boom);

      await expect(service.createRoom(USER_ID, { name: 'Focus' })).rejects.toBe(boom);
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('leaveRoom / getMyRoom без комнаты', () => {
    it('leaveRoom: нет активного участия → NOT_IN_ROOM (404), транзакция не открывается', async () => {
      const { service, manager, transaction } = setup();
      manager.findOne.mockResolvedValueOnce(null);

      const error = await errorOf(service.leaveRoom(USER_ID));
      expect(codeOf(error)).toBe(ErrorCode.NOT_IN_ROOM);
      expect((error as AppException).getStatus()).toBe(404);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('getMyRoom: нет активного участия → NOT_IN_ROOM (404)', async () => {
      const { service, manager } = setup();
      manager.findOne.mockResolvedValueOnce(null);

      const error = await errorOf(service.getMyRoom(USER_ID));
      expect(codeOf(error)).toBe(ErrorCode.NOT_IN_ROOM);
      expect((error as AppException).getStatus()).toBe(404);
    });
  });

  describe('getRoom / getMembers для чужой комнаты', () => {
    it('комнаты нет → ROOM_NOT_FOUND (404)', async () => {
      const { service, manager } = setup();
      manager.findOneBy.mockResolvedValueOnce(null);

      const error = await errorOf(service.getRoom(USER_ID, 'room-1'));
      expect(codeOf(error)).toBe(ErrorCode.ROOM_NOT_FOUND);
      expect((error as AppException).getStatus()).toBe(404);
    });

    it('комната есть, но пользователь не её активный участник → NOT_IN_ROOM (403)', async () => {
      const { service, manager } = setup();
      manager.findOneBy.mockResolvedValue({ id: 'room-1' });
      manager.findOne.mockResolvedValue(null);

      for (const call of [
        () => service.getRoom(USER_ID, 'room-1'),
        () => service.getMembers(USER_ID, 'room-1'),
      ]) {
        const error = await errorOf(call());
        expect(codeOf(error)).toBe(ErrorCode.NOT_IN_ROOM);
        expect((error as AppException).getStatus()).toBe(403);
      }
    });
  });
});
