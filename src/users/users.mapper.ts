import { PublicProfileDto, UserProfileDto } from './dto/user-profile.dto';
import { User } from './entities/user.entity';
import { PROGRESSION_RULES, progressionForXp } from '../progression/progression.rules';

/** Сущность никогда не отдаётся клиенту напрямую — только через явные DTO. */
export function toUserProfile(user: User): UserProfileDto {
  if (!user.stats || !user.settings) {
    throw new Error(`У пользователя ${user.id} отсутствуют user_stats или user_settings`);
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    stats: {
      xp: user.stats.xp,
      level: user.stats.level,
      coins: user.stats.coins,
      sessionsCompleted: user.stats.sessionsCompleted,
      collabSessionsCompleted: user.stats.collabSessionsCompleted,
      activeDays: user.stats.activeDays,
    },
    progression: {
      ...progressionForXp(user.stats.xp),
      focusXp: PROGRESSION_RULES.focusXp,
      focusCoins: PROGRESSION_RULES.focusCoins,
      teamBonusPercent: PROGRESSION_RULES.teamBonusPercent,
    },
    settings: {
      allowPranks: user.settings.allowPranks,
      timezone: user.settings.timezone,
    },
  };
}

export function toPublicProfile(user: User): PublicProfileDto {
  if (!user.stats) {
    throw new Error(`У пользователя ${user.id} отсутствует user_stats`);
  }
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    level: user.stats.level,
    xp: user.stats.xp,
    createdAt: user.createdAt,
  };
}
