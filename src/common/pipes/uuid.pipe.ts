import { HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/** Проверка UUID в параметрах маршрута с ошибкой в едином формате. */
export const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(
      ErrorCode.VALIDATION_ERROR,
      'Некорректный идентификатор (ожидается UUID)',
      HttpStatus.BAD_REQUEST,
    ),
});
