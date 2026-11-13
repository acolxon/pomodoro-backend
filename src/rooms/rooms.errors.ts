import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { getPgErrorInfo, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION } from '../common/utils/pg-error';

/** Имена ограничений из миграции Rooms. */
export const UQ_INVITE_CODE = 'uq_rooms_invite_code';
export const UQ_ACTIVE_USER = 'uq_room_members_active_user';
export const CK_ROOM_CAPACITY = 'ck_room_capacity';

export const roomErrors = {
  notFound: (): AppException =>
    new AppException(ErrorCode.ROOM_NOT_FOUND, 'Комната не найдена', HttpStatus.NOT_FOUND),

  closed: (): AppException =>
    new AppException(ErrorCode.ROOM_CLOSED, 'Комната закрыта', HttpStatus.CONFLICT),

  full: (): AppException =>
    new AppException(ErrorCode.ROOM_FULL, 'В комнате нет свободных мест', HttpStatus.CONFLICT),

  alreadyInRoom: (): AppException =>
    new AppException(
      ErrorCode.ALREADY_IN_ROOM,
      'Вы уже находитесь в комнате. Сначала выйдите из неё',
      HttpStatus.CONFLICT,
    ),

  /** Пользователь не состоит ни в одной комнате (для /rooms/me и /rooms/leave). */
  notInAnyRoom: (): AppException =>
    new AppException(ErrorCode.NOT_IN_ROOM, 'Вы не состоите в комнате', HttpStatus.NOT_FOUND),

  /** Доступ к чужой комнате: смотреть и управлять могут только её активные участники. */
  notMemberOfRoom: (): AppException =>
    new AppException(
      ErrorCode.NOT_IN_ROOM,
      'Вы не являетесь участником этой комнаты',
      HttpStatus.FORBIDDEN,
    ),

  notOwner: (): AppException =>
    new AppException(
      ErrorCode.NOT_ROOM_OWNER,
      'Это действие доступно только владельцу комнаты',
      HttpStatus.FORBIDDEN,
    ),

  invalidInviteCode: (): AppException =>
    new AppException(
      ErrorCode.INVALID_INVITE_CODE,
      'Неверный код приглашения',
      HttpStatus.NOT_FOUND,
    ),

  memberNotFound: (): AppException =>
    new AppException(
      ErrorCode.ROOM_MEMBER_NOT_FOUND,
      'Пользователь не является участником этой комнаты',
      HttpStatus.NOT_FOUND,
    ),

  alreadyOwner: (): AppException =>
    new AppException(
      ErrorCode.BAD_REQUEST,
      'Вы уже являетесь владельцем комнаты',
      HttpStatus.BAD_REQUEST,
    ),
};

/** true, если ошибка — нарушение уникальности invite_code (нужно повторить с новым кодом). */
export function isInviteCodeCollision(error: unknown): boolean {
  const { code, constraint } = getPgErrorInfo(error);
  return code === PG_UNIQUE_VIOLATION && constraint === UQ_INVITE_CODE;
}

/**
 * Превращает ошибки ограничений БД в доменные ошибки API.
 * Возвращает null, если ошибка не относится к известным ограничениям комнат
 * (тогда вызывающий пробрасывает исходную ошибку → 500).
 *
 * Это страховка от гонок: сервис проверяет условия заранее ради понятных ответов,
 * а окончательное слово всегда за БД.
 */
export function mapRoomDbError(error: unknown): AppException | null {
  const { code, constraint } = getPgErrorInfo(error);
  if (code === PG_UNIQUE_VIOLATION && constraint === UQ_ACTIVE_USER) {
    return roomErrors.alreadyInRoom();
  }
  if (code === PG_CHECK_VIOLATION && constraint === CK_ROOM_CAPACITY) {
    return roomErrors.full();
  }
  return null;
}
