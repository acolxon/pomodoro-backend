/** Код PostgreSQL для нарушения уникальности. */
export const PG_UNIQUE_VIOLATION = '23505';

export interface PgErrorInfo {
  code?: string;
  constraint?: string;
}

/**
 * Достаёт код и имя ограничения из ошибки драйвера pg
 * (TypeORM оборачивает её в QueryFailedError.driverError).
 */
export function getPgErrorInfo(error: unknown): PgErrorInfo {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  const outer = error as { driverError?: unknown; code?: unknown; constraint?: unknown };
  const source =
    typeof outer.driverError === 'object' && outer.driverError !== null
      ? (outer.driverError as { code?: unknown; constraint?: unknown })
      : outer;

  return {
    code: typeof source.code === 'string' ? source.code : undefined,
    constraint: typeof source.constraint === 'string' ? source.constraint : undefined,
  };
}
