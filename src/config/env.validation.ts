import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** Все переменные окружения приложения. Невалидная конфигурация = приложение не стартует. */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:5173';

  @IsInt()
  @Min(1)
  @Max(86400)
  POMODORO_MAX_PAUSE_SECONDS: number = 900;

  @IsIn(['true', 'false'])
  SWAGGER_ENABLED: string = 'true';

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS: number = 604800;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    );
    throw new Error(`Некорректная конфигурация окружения (.env):\n${lines.join('\n')}`);
  }

  if (validated.NODE_ENV === NodeEnv.Production && validated.JWT_SECRET.startsWith('change_me')) {
    throw new Error(
      'Некорректная конфигурация окружения (.env):\n  - JWT_SECRET: замените значение-заглушку на случайную строку',
    );
  }

  return validated;
}
