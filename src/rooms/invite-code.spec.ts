import {
  generateInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  isValidInviteCode,
  normalizeInviteCode,
} from './invite-code';

describe('invite-code', () => {
  it('алфавит: 32 уникальных символа без похожих (I, O, 0, 1)', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(32);
    for (const forbidden of ['I', 'O', '0', '1']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(forbidden);
    }
  });

  it('генерирует коды фиксированной длины, проходящие проверку формата', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(isValidInviteCode(code)).toBe(true);
    }
  });

  it('коды не повторяются на практике (случайность, а не счётчик)', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateInviteCode()));
    expect(codes.size).toBe(2000);
  });

  it('используются все символы алфавита (нет «мёртвых» символов)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      for (const char of generateInviteCode()) {
        seen.add(char);
      }
    }
    expect(seen.size).toBe(32);
  });

  it('normalizeInviteCode убирает пробелы и приводит к верхнему регистру', () => {
    expect(normalizeInviteCode('  k7m2qx9p \n')).toBe('K7M2QX9P');
  });

  it.each([
    ['', false],
    ['K7M2QX9', false], // 7 символов
    ['K7M2QX9PA', false], // 9 символов
    ['K7M2QX90', false], // содержит 0
    ['K7M2QXIO', false], // содержит I и O
    ['k7m2qx9p', false], // нижний регистр: сначала normalizeInviteCode
    ['K7M2-X9P', false],
    ['K7M2QX9P', true],
  ])('isValidInviteCode(%j) → %s', (code, expected) => {
    expect(isValidInviteCode(code)).toBe(expected);
  });
});
