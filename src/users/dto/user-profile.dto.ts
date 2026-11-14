import { ApiProperty } from '@nestjs/swagger';

export class UserProgressionDto {
  @ApiProperty({ example: 1 }) level!: number;
  @ApiProperty({ example: 0 }) currentLevelXp!: number;
  @ApiProperty({ example: 100 }) nextLevelXp!: number;
  @ApiProperty({ example: 25 }) xpInLevel!: number;
  @ApiProperty({ example: 100 }) xpRequiredForLevel!: number;
  @ApiProperty({ example: 75 }) xpToNextLevel!: number;
  @ApiProperty({ example: 25 }) progressPercent!: number;
  @ApiProperty({ example: 25 }) focusXp!: number;
  @ApiProperty({ example: 10 }) focusCoins!: number;
  @ApiProperty({ example: 20 }) teamBonusPercent!: number;
}

export class UserStatsDto {
  @ApiProperty({ example: 0 }) xp!: number;
  @ApiProperty({ example: 1 }) level!: number;
  @ApiProperty({ example: 0 }) coins!: number;
  @ApiProperty({ example: 0 }) sessionsCompleted!: number;
  @ApiProperty({ example: 0 }) collabSessionsCompleted!: number;
  @ApiProperty({ example: 0 }) activeDays!: number;
}

export class UserSettingsDto {
  @ApiProperty({ example: true }) allowPranks!: boolean;
  @ApiProperty({ example: 'UTC' }) timezone!: string;
}

/** Полный профиль — только для самого пользователя. */
export class UserProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'alice_01' }) username!: string;
  @ApiProperty({ example: 'alice@example.com' }) email!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: UserStatsDto }) stats!: UserStatsDto;
  @ApiProperty({ type: UserProgressionDto }) progression!: UserProgressionDto;
  @ApiProperty({ type: UserSettingsDto }) settings!: UserSettingsDto;
}

/** Публичный профиль — без email, Coins и настроек. */
export class PublicProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'alice_01' }) username!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!: string | null;
  @ApiProperty({ example: 1 }) level!: number;
  @ApiProperty({ example: 0 }) xp!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
