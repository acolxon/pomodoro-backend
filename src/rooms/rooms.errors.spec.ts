import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { toErrorBody } from '../common/filters/all-exceptions.filter';
import { isInviteCodeCollision, mapRoomDbError, roomErrors } from './rooms.errors';

const pgError = (code: string, constraint?: string) => ({ driverError: { code, constraint } });

describe('mapRoomDbError', () => {
  it('uq_room_members_active_user → ALREADY_IN_ROOM (409)', () => {
    const mapped = mapRoomDbError(pgError('23505', 'uq_room_members_active_user'));
    expect(mapped).toBeInstanceOf(AppException);
    expect(toErrorBody(mapped)).toMatchObject({ statusCode: 409, code: ErrorCode.ALREADY_IN_ROOM });
  });

  it('ck_room_capacity → ROOM_FULL (409)', () => {
    const mapped = mapRoomDbError(pgError('23514', 'ck_room_capacity'));
    expect(toErrorBody(mapped)).toMatchObject({ statusCode: 409, code: ErrorCode.ROOM_FULL });
  });

  it('неизвестные ограничения не маскируются (null → ошибка уйдёт как 500)', () => {
    expect(mapRoomDbError(pgError('23505', 'uq_users_email_lower'))).toBeNull();
    expect(mapRoomDbError(pgError('23514', 'ck_room_owner_is_member'))).toBeNull();
    expect(mapRoomDbError(pgError('23514', 'ck_room_closed_empty'))).toBeNull();
    expect(mapRoomDbError(new Error('boom'))).toBeNull();
    expect(mapRoomDbError(null)).toBeNull();
  });

  it('код ошибки важен: то же имя ограничения с другим кодом не подходит', () => {
    expect(mapRoomDbError(pgError('23514', 'uq_room_members_active_user'))).toBeNull();
    expect(mapRoomDbError(pgError('23505', 'ck_room_capacity'))).toBeNull();
  });
});

describe('isInviteCodeCollision', () => {
  it('распознаёт только нарушение uq_rooms_invite_code', () => {
    expect(isInviteCodeCollision(pgError('23505', 'uq_rooms_invite_code'))).toBe(true);
    expect(isInviteCodeCollision(pgError('23505', 'uq_room_members_active_user'))).toBe(false);
    expect(isInviteCodeCollision(pgError('23514', 'uq_rooms_invite_code'))).toBe(false);
    expect(isInviteCodeCollision(undefined)).toBe(false);
  });
});

describe('roomErrors', () => {
  it.each([
    ['notFound', 404, ErrorCode.ROOM_NOT_FOUND],
    ['closed', 409, ErrorCode.ROOM_CLOSED],
    ['full', 409, ErrorCode.ROOM_FULL],
    ['alreadyInRoom', 409, ErrorCode.ALREADY_IN_ROOM],
    ['notInAnyRoom', 404, ErrorCode.NOT_IN_ROOM],
    ['notMemberOfRoom', 403, ErrorCode.NOT_IN_ROOM],
    ['notOwner', 403, ErrorCode.NOT_ROOM_OWNER],
    ['invalidInviteCode', 404, ErrorCode.INVALID_INVITE_CODE],
    ['memberNotFound', 404, ErrorCode.ROOM_MEMBER_NOT_FOUND],
    ['alreadyOwner', 400, ErrorCode.BAD_REQUEST],
  ] as const)('%s → %i %s в едином формате ответа', (factory, status, code) => {
    expect(toErrorBody(roomErrors[factory]())).toMatchObject({
      statusCode: status,
      code,
      message: expect.any(String),
    });
  });
});
