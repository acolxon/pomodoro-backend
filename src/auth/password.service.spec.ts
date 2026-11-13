import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('хеширует пароль алгоритмом argon2id и не хранит его в открытом виде', async () => {
    const hash = await service.hash('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct-horse-battery');
  });

  it('подтверждает верный пароль', async () => {
    const hash = await service.hash('correct-horse-battery');
    await expect(service.verify(hash, 'correct-horse-battery')).resolves.toBe(true);
  });

  it('отклоняет неверный пароль', async () => {
    const hash = await service.hash('correct-horse-battery');
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('использует соль: одинаковые пароли дают разные хеши', async () => {
    const [a, b] = await Promise.all([service.hash('same-password'), service.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('возвращает false для повреждённого хеша вместо исключения', async () => {
    await expect(service.verify('not-a-valid-hash', 'whatever')).resolves.toBe(false);
  });

  it('хеш-пустышка вычисляется один раз и никогда не подходит реальному паролю', async () => {
    const first = await service.getDummyHash();
    const second = await service.getDummyHash();
    expect(second).toBe(first);
    await expect(service.verify(first, 'correct-horse-battery')).resolves.toBe(false);
  });
});
