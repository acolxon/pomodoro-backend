import { ApiProperty } from '@nestjs/swagger';

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
