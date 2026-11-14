import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HistoryQueryDto } from './history-query.dto';
import { HistoryStatsQueryDto } from './history-stats-query.dto';

describe('History filters', () => {
  const roomId = '16122422-d551-4be1-a6be-31505d8f4ceb';
  it.each([HistoryQueryDto, HistoryStatsQueryDto])(
    'accepts room and date filters on %p',
    async (Dto) => {
      const query = plainToInstance(Dto, {
        roomId,
        status: 'cancelled',
        from: '2026-11-01T00:00:00Z',
        to: '2026-11-15T00:00:00Z',
      });
      expect(await validate(query)).toHaveLength(0);
      expect(query.roomId).toBe(roomId);
    },
  );
  it.each([HistoryQueryDto, HistoryStatsQueryDto])(
    'rejects malformed room ids on %p',
    async (Dto) => {
      const query = plainToInstance(Dto, { roomId: 'not-a-uuid' });
      expect((await validate(query)).map((error) => error.property)).toContain('roomId');
    },
  );
});
