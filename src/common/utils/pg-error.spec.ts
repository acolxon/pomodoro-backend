import { getPgErrorInfo, PG_UNIQUE_VIOLATION } from './pg-error';

describe('getPgErrorInfo', () => {
  it('читает код и ограничение из driverError (QueryFailedError)', () => {
    const error = { driverError: { code: '23505', constraint: 'uq_users_email_lower' } };
    expect(getPgErrorInfo(error)).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'uq_users_email_lower',
    });
  });

  it('читает поля напрямую, если driverError отсутствует', () => {
    expect(getPgErrorInfo({ code: '23505', constraint: 'x' })).toEqual({
      code: '23505',
      constraint: 'x',
    });
  });

  it('безопасно обрабатывает не-объекты', () => {
    expect(getPgErrorInfo(null)).toEqual({});
    expect(getPgErrorInfo('boom')).toEqual({});
  });
});
