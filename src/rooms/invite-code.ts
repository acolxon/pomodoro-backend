import { randomBytes } from 'crypto';

/**
 * 32 символа без похожих (нет I, O, 0, 1). Длина алфавита — степень двойки,
 * поэтому выбор символа по младшим 5 битам случайного байта не даёт смещения.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

/** Тот же формат проверяет CHECK ck_rooms_invite_code_format в БД. */
export const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += INVITE_CODE_ALPHABET[byte & 31];
  }
  return code;
}

/** Приводит ввод пользователя к каноническому виду: пробелы по краям и регистр не важны. */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(code);
}
