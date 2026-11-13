import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Проверка работоспособности сервера и подключения к БД' })
  @ApiOkResponse({ description: '{ status: "ok", database: "up", ... }' })
  async check(): Promise<{
    status: 'ok';
    database: 'up';
    uptimeSeconds: number;
    timestamp: string;
  }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'База данных недоступна',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: 'ok',
      database: 'up',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
