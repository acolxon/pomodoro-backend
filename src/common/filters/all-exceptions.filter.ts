import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException, AppExceptionPayload } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const DEFAULT_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.TOO_MANY_REQUESTS,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

/** Чистая функция преобразования исключения в тело ответа (удобно тестировать отдельно). */
export function toErrorBody(exception: unknown): ErrorBody {
  if (exception instanceof AppException) {
    const payload = exception.getResponse() as AppExceptionPayload;
    return {
      statusCode: exception.getStatus(),
      code: payload.code,
      message: payload.message,
      details: payload.details,
    };
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    let message: string;
    let details: unknown;

    if (typeof response === 'string') {
      message = response;
    } else {
      const obj = response as { message?: string | string[] };
      if (Array.isArray(obj.message)) {
        message = 'Некорректный запрос';
        details = obj.message;
      } else {
        message = obj.message ?? exception.message;
      }
    }

    return {
      statusCode,
      code: DEFAULT_CODES[statusCode] ?? ErrorCode.HTTP_ERROR,
      message,
      details,
    };
  }

  return {
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Внутренняя ошибка сервера',
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // WebSocket-ошибки обрабатываются отдельным фильтром шлюза.
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const body = toErrorBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json({
      ...body,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
