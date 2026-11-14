import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';
import { UpdateTaskDto } from './update-task.dto';

describe('Task input validation', () => {
  it.each([{ title: '' }, { title: '   ' }, { title: null }, { title: 'x'.repeat(121) }])(
    'rejects invalid task creation: %j',
    async (body) => {
      expect((await validate(plainToInstance(CreateTaskDto, body))).length).toBeGreaterThan(0);
    },
  );

  it.each([
    { title: null },
    { status: null },
    { status: 'unknown' },
    { title: '  ' },
    { description: 'x'.repeat(5001) },
  ])('rejects invalid partial updates: %j', async (body) => {
    expect((await validate(plainToInstance(UpdateTaskDto, body))).length).toBeGreaterThan(0);
  });

  it('trims titles and clears blank descriptions while preserving omitted fields', async () => {
    const dto = plainToInstance(UpdateTaskDto, { title: '  Read  ', description: '  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toEqual({ title: 'Read', description: null });
    expect(await validate(plainToInstance(UpdateTaskDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTaskDto, { description: null }))).toHaveLength(0);
  });
});
