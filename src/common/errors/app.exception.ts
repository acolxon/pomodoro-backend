import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface AppExceptionPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Доменная ошибка с машинным кодом. Единый формат ответа формирует AllExceptionsFilter. */
export class AppException extends HttpException {
  constructor(code: ErrorCode, message: string, status: HttpStatus | number, details?: unknown) {
    const payload: AppExceptionPayload = { code, message, details };
    super(payload, status);
  }
}
