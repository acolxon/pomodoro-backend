import { activityDate, focusReward, progressionForXp } from './progression.rules';

describe('Progression balance', () => {
  it.each([
    [0, 1, 0, 100],
    [99, 1, 99, 1],
    [100, 2, 0, 200],
    [299, 2, 199, 1],
    [300, 3, 0, 300],
    [600, 4, 0, 400],
    [1000, 5, 0, 500],
  ])('maps %i XP to level %i with a consistent next threshold', (xp, level, inLevel, remaining) => {
    const result = progressionForXp(xp);
    expect(result.level).toBe(level);
    expect(result.xpInLevel).toBe(inLevel);
    expect(result.xpToNextLevel).toBe(remaining);
    expect(result.xpRequiredForLevel).toBe(inLevel + remaining);
    expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    expect(result.progressPercent).toBeLessThan(100);
  });

  it('keeps progress bounded up to the PostgreSQL integer limit', () => {
    const result = progressionForXp(2_147_483_647);
    expect(result.currentLevelXp).toBeLessThanOrEqual(2_147_483_647);
    expect(result.nextLevelXp).toBeGreaterThan(2_147_483_647);
  });

  it('awards base and team rewards with server rounding', () => {
    expect(focusReward(false)).toEqual({ xp: 25, coins: 10 });
    expect(focusReward(true)).toEqual({ xp: 30, coins: 12 });
  });

  it('uses the user timezone for activity days across midnight', () => {
    const instant = new Date('2026-11-15T22:30:00Z');
    expect(activityDate(instant, 'UTC')).toBe('2026-11-15');
    expect(activityDate(instant, 'Asia/Almaty')).toBe('2026-11-16');
    expect(activityDate(instant, 'America/New_York')).toBe('2026-11-15');
  });
});
