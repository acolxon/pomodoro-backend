/** Server-owned balance. Clients display these values, never calculate rewards. */
export const PROGRESSION_RULES = Object.freeze({
  focusXp: 25,
  focusCoins: 10,
  teamBonusPercent: 20,
  levelStepXp: 100,
  xpBoosterPrice: 20,
  xpBoosterPercent: 10,
});

/** Total XP needed to reach a level: 0, 100, 300, 600, 1000, ... */
export function levelStartXp(level: number): number {
  return (PROGRESSION_RULES.levelStepXp * level * (level - 1)) / 2;
}

export function progressionForXp(xp: number) {
  const level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / PROGRESSION_RULES.levelStepXp)) / 2);
  const currentLevelXp = levelStartXp(level);
  const nextLevelXp = levelStartXp(level + 1);
  const xpInLevel = xp - currentLevelXp;
  const xpRequiredForLevel = nextLevelXp - currentLevelXp;
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpInLevel,
    xpRequiredForLevel,
    xpToNextLevel: nextLevelXp - xp,
    progressPercent: Math.floor((xpInLevel * 100) / xpRequiredForLevel),
  };
}

export function focusReward(teamBonus: boolean) {
  const multiplier = teamBonus ? 1 + PROGRESSION_RULES.teamBonusPercent / 100 : 1;
  return {
    xp: Math.floor(PROGRESSION_RULES.focusXp * multiplier),
    coins: Math.floor(PROGRESSION_RULES.focusCoins * multiplier),
  };
}

/** Booster applies after the team bonus; fractional XP rounds down. */
export function boostedXp(baseXp: number): number {
  return baseXp + Math.floor((baseXp * PROGRESSION_RULES.xpBoosterPercent) / 100);
}

export function activityDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((value) => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
