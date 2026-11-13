import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { UsersService } from '../users/users.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { JwtPayload } from './types/auth-user';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.createUser({
      username: dto.username,
      email: dto.email.trim().toLowerCase(),
      passwordHash,
    });
    return this.buildAuthResponse(user.id, user.username);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findForLogin(dto.login);

    // Пароль проверяется всегда (для несуществующего пользователя — по хешу-пустышке),
    // ответ одинаков для «нет такого пользователя» и «неверный пароль».
    const hash = user?.passwordHash ?? (await this.passwords.getDummyHash());
    const passwordOk = await this.passwords.verify(hash, dto.password);

    if (!user || !passwordOk) {
      throw new AppException(
        ErrorCode.INVALID_CREDENTIALS,
        'Неверный логин или пароль',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.buildAuthResponse(user.id, user.username);
  }

  private async buildAuthResponse(userId: string, username: string): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: userId, username };
    const accessToken = await this.jwt.signAsync(payload);
    const profile = await this.users.getProfile(userId);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
      user: profile,
    };
  }
}
