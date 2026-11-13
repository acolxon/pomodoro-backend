import { ValidationError } from 'class-validator';
import { flattenValidationErrors } from './validation.pipe';

describe('flattenValidationErrors', () => {
  it('раскладывает ошибки, включая вложенные поля', () => {
    const errors = [
      { property: 'email', constraints: { isEmail: 'email must be an email' } },
      {
        property: 'settings',
        children: [{ property: 'timezone', constraints: { isTimeZoneName: 'bad zone' } }],
      },
    ] as unknown as ValidationError[];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'email', messages: ['email must be an email'] },
      { field: 'settings.timezone', messages: ['bad zone'] },
    ]);
  });
});
