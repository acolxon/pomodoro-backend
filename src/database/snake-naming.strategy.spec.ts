import { SnakeNamingStrategy, toSnakeCase } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  it('преобразует camelCase в snake_case', () => {
    expect(toSnakeCase('createdAt')).toBe('created_at');
    expect(toSnakeCase('collabSessionsCompleted')).toBe('collab_sessions_completed');
    expect(toSnakeCase('userID')).toBe('user_id');
    expect(toSnakeCase('xp')).toBe('xp');
  });

  it('columnName: использует snake_case, если имя не задано явно', () => {
    expect(strategy.columnName('lastActiveDate', '', [])).toBe('last_active_date');
  });

  it('columnName: уважает явно заданное имя', () => {
    expect(strategy.columnName('passwordHash', 'password_hash', [])).toBe('password_hash');
  });

  it('columnName: учитывает префиксы встроенных сущностей', () => {
    expect(strategy.columnName('street', '', ['homeAddress'])).toBe('home_address_street');
  });

  it('joinColumnName: связывает имя связи и колонку', () => {
    expect(strategy.joinColumnName('owner', 'id')).toBe('owner_id');
  });
});
