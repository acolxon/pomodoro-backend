import { ArgumentMetadata } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateRoomDto } from './create-room.dto';
import { JoinRoomDto } from './join-room.dto';
import { TransferOwnerDto } from './transfer-owner.dto';

const pipe = createValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

async function expectValidationError(value: unknown, metatype: ArgumentMetadata['metatype']) {
  const error = await pipe.transform(value, meta(metatype)).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getResponse()).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
}

describe('CreateRoomDto', () => {
  it('принимает название и обрезает пробелы по краям', async () => {
    const dto = (await pipe.transform(
      { name: '  Deep Work  ' },
      meta(CreateRoomDto),
    )) as CreateRoomDto;
    expect(dto.name).toBe('Deep Work');
    expect(dto.maxMembers).toBeUndefined();
  });

  it('принимает maxMembers в диапазоне 2–50', async () => {
    for (const maxMembers of [2, 10, 50]) {
      const dto = (await pipe.transform(
        { name: 'r', maxMembers },
        meta(CreateRoomDto),
      )) as CreateRoomDto;
      expect(dto.maxMembers).toBe(maxMembers);
    }
  });

  it.each([
    ['пустое название', { name: '' }],
    ['название из пробелов', { name: '   ' }],
    ['название длиннее 50', { name: 'x'.repeat(51) }],
    ['название не строка', { name: 123 }],
    ['нет названия', {}],
    ['maxMembers = 1', { name: 'r', maxMembers: 1 }],
    ['maxMembers = 51', { name: 'r', maxMembers: 51 }],
    ['maxMembers дробный', { name: 'r', maxMembers: 2.5 }],
    ['maxMembers строкой', { name: 'r', maxMembers: '5' }],
    ['лишнее поле (ownerId)', { name: 'r', ownerId: '00000000-0000-4000-8000-000000000000' }],
    ['лишнее поле (inviteCode)', { name: 'r', inviteCode: 'AAAAAAAA' }],
  ])('отклоняет: %s', async (_title, body) => {
    await expectValidationError(body, CreateRoomDto);
  });
});

describe('JoinRoomDto', () => {
  it('принимает строку', async () => {
    const dto = (await pipe.transform(
      { inviteCode: 'K7M2QX9P' },
      meta(JoinRoomDto),
    )) as JoinRoomDto;
    expect(dto.inviteCode).toBe('K7M2QX9P');
  });

  it.each([
    ['пустой код', { inviteCode: '' }],
    ['нет кода', {}],
    ['не строка', { inviteCode: 12345678 }],
    ['слишком длинный', { inviteCode: 'A'.repeat(65) }],
    ['лишнее поле', { inviteCode: 'K7M2QX9P', roomId: 'x' }],
  ])('отклоняет: %s', async (_title, body) => {
    await expectValidationError(body, JoinRoomDto);
  });
});

describe('TransferOwnerDto', () => {
  it('принимает UUID', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const dto = (await pipe.transform(
      { newOwnerId: id },
      meta(TransferOwnerDto),
    )) as TransferOwnerDto;
    expect(dto.newOwnerId).toBe(id);
  });

  it.each([
    ['не UUID', { newOwnerId: 'bob' }],
    ['нет поля', {}],
    ['лишнее поле', { newOwnerId: '00000000-0000-4000-8000-000000000001', role: 'owner' }],
  ])('отклоняет: %s', async (_title, body) => {
    await expectValidationError(body, TransferOwnerDto);
  });
});
