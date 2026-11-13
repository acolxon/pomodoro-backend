import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { toErrorBody } from './all-exceptions.filter';

describe('toErrorBody', () => {
  it('сохраняет код и детали AppException', () => {
    const body = toErrorBody(
      new AppException(ErrorCode.EMAIL_TAKEN, 'занято', HttpStatus.CONFLICT, { field: 'email' }),
    );
    expect(body).toEqual({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'занято',
      details: { field: 'email' },
    });
  });

  it('присваивает код по статусу для стандартных HttpException', () => {
    const body = toErrorBody(new NotFoundException('нет такого'));
    expect(body.statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toBe('нет такого');
  });

  it('переносит массив сообщений в details', () => {
    const body = toErrorBody(new BadRequestException(['a must be string', 'b is required']));
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.details).toEqual(['a must be string', 'b is required']);
  });

  it('не раскрывает внутренние детали неизвестных ошибок', () => {
    const body = toErrorBody(new Error('connection string: postgres://user:secret@host'));
    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
    });
  });
});
