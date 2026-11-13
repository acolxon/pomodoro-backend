import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { getPgErrorInfo, PG_UNIQUE_VIOLATION } from '../common/utils/pg-error';
import { PublicProfileDto, UserProfileDto } from './dto/user-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UserSettings } from './entities/user-settings.entity';
import { UserStats } from './entities/user-stats.entity';
import { User } from './entities/user.entity';
import { toPublicProfile, toUserProfile } from './users.mapper';

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

/** Имена уникальных индексов из миграции InitFoundation. */
const UQ_USERNAME = 'uq_users_username_lower';
const UQ_EMAIL = 'uq_users_email_lower';

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(UserSettings) private readonly settingsRepo: Repository<UserSettings>,
  ) {}

  /**
   * Создаёт пользователя вместе с user_stats и user_settings в одной транзакции.
   * Уникальность username/email гарантирует БД (устойчиво к гонкам запросов).
   */
  async createUser(input: CreateUserInput): Promise<User> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          manager.create(User, {
            username: input.username,
            email: input.email,
            passwordHash: input.passwordHash,
            avatarUrl: null,
          }),
        );
        await manager.insert(UserStats, { userId: user.id });
        await manager.insert(UserSettings, { userId: user.id });
        return user;
      });
    } catch (error) {
      this.rethrowUniqueViolation(error);
      throw error;
    }
  }

  /** Поиск для входа по email или username (без учёта регистра), вместе с хешем пароля. */
  async findForLogin(login: string): Promise<User | null> {
    const normalized = login.trim().toLowerCase();
    const qb = this.usersRepo.createQueryBuilder('u').addSelect('u.passwordHash');
    if (normalized.includes('@')) {
      qb.where('lower(u.email) = :value', { value: normalized });
    } else {
      qb.where('lower(u.username) = :value', { value: normalized });
    }
    return qb.getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } });
  }

  async getProfile(id: string): Promise<UserProfileDto> {
    const user = await this.usersRepo.findOne({
      where: { id },
      relations: { stats: true, settings: true },
    });
    if (!user) {
      throw this.userNotFound();
    }
    return toUserProfile(user);
  }

  async getPublicProfile(id: string): Promise<PublicProfileDto> {
    const user = await this.usersRepo.findOne({ where: { id }, relations: { stats: true } });
    if (!user) {
      throw this.userNotFound();
    }
    return toPublicProfile(user);
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<UserProfileDto> {
    const patch: Partial<Pick<UserSettings, 'allowPranks' | 'timezone'>> = {};
    if (dto.allowPranks !== undefined) {
      patch.allowPranks = dto.allowPranks;
    }
    if (dto.timezone !== undefined) {
      patch.timezone = dto.timezone;
    }
    if (Object.keys(patch).length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Передайте хотя бы одно поле настроек',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.settingsRepo.update({ userId }, patch);
    return this.getProfile(userId);
  }

  private userNotFound(): AppException {
    return new AppException(ErrorCode.USER_NOT_FOUND, 'Пользователь не найден', HttpStatus.NOT_FOUND);
  }

  private rethrowUniqueViolation(error: unknown): void {
    const { code, constraint } = getPgErrorInfo(error);
    if (code !== PG_UNIQUE_VIOLATION) {
      return;
    }
    if (constraint === UQ_USERNAME) {
      throw new AppException(
        ErrorCode.USERNAME_TAKEN,
        'Это имя пользователя уже занято',
        HttpStatus.CONFLICT,
      );
    }
    if (constraint === UQ_EMAIL) {
      throw new AppException(
        ErrorCode.EMAIL_TAKEN,
        'Пользователь с таким email уже существует',
        HttpStatus.CONFLICT,
      );
    }
  }
}
