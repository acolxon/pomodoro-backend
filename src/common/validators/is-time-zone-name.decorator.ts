import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Проверяет, что строка является корректным IANA-часовым поясом (например, Asia/Almaty). */
export function IsTimeZoneName(options?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'isTimeZoneName',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isValidTimeZone(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a valid IANA time zone (e.g. Asia/Almaty)`,
      },
    });
  };
}
