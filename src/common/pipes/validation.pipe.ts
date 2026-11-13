import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export interface FieldErrors {
  field: string;
  messages: string[];
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldErrors[] {
  const result: FieldErrors[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      result.push({ field, messages: Object.values(error.constraints) });
    }
    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }
  return result;
}

/** Глобальная валидация DTO: лишние поля запрещены, ошибки в едином формате. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Ошибка валидации входных данных',
        HttpStatus.BAD_REQUEST,
        flattenValidationErrors(errors),
      ),
  });
}
