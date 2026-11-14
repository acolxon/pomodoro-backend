import { validateEnv } from './env.validation';

const base = {
  DB_HOST: 'localhost',
  DB_USER: 'user',
  DB_PASSWORD: 'password',
  DB_NAME: 'db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('принимает минимальную конфигурацию и подставляет значения по умолчанию', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(5432);
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(604800);
    expect(env.SWAGGER_ENABLED).toBe('true');
    expect(env.POMODORO_MAX_PAUSE_SECONDS).toBe(900);
  });

  it('преобразует числовые строки в числа', () => {
    const env = validateEnv({ ...base, PORT: '4000', DB_PORT: '5433' });
    expect(env.PORT).toBe(4000);
    expect(env.DB_PORT).toBe(5433);
  });

  it('падает, если не задан DB_HOST', () => {
    const { DB_HOST: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DB_HOST/);
  });

  it('падает, если JWT_SECRET короче 32 символов', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('падает при недопустимом NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('в production запрещает значение-заглушку JWT_SECRET', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'change_me_to_a_long_random_string_at_least_32_chars',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('converts and validates the pause timeout', () => {
    expect(
      validateEnv({ ...base, POMODORO_MAX_PAUSE_SECONDS: '120' }).POMODORO_MAX_PAUSE_SECONDS,
    ).toBe(120);
  });

  it.each(['0', '-1', '0.5', 'NaN'])('rejects an invalid pause timeout: %s', (value) => {
    expect(() => validateEnv({ ...base, POMODORO_MAX_PAUSE_SECONDS: value })).toThrow(
      /POMODORO_MAX_PAUSE_SECONDS/,
    );
  });
});
