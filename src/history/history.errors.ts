import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export const historyErrors = {
  notFound: () =>
    new AppException(
      ErrorCode.HISTORY_NOT_FOUND,
      'Запись истории не найдена',
      HttpStatus.NOT_FOUND,
    ),
  invalidPeriod: () =>
    new AppException(
      ErrorCode.BAD_REQUEST,
      'Начало периода должно быть раньше конца',
      HttpStatus.BAD_REQUEST,
    ),
};
