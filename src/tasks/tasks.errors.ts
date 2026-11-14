import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { getPgErrorInfo, PG_UNIQUE_VIOLATION } from '../common/utils/pg-error';

export const taskErrors = {
  notFound: () =>
    new AppException(ErrorCode.TASK_NOT_FOUND, 'Задача не найдена', HttpStatus.NOT_FOUND),
  activeTaskExists: () =>
    new AppException(
      ErrorCode.ACTIVE_TASK_EXISTS,
      'У пользователя уже есть активная задача',
      HttpStatus.CONFLICT,
    ),
};

export function isActiveTaskCollision(error: unknown): boolean {
  const { code, constraint } = getPgErrorInfo(error);
  return code === PG_UNIQUE_VIOLATION && constraint === 'uq_tasks_one_in_progress_per_user';
}
