import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfiguredIoAdapter } from './realtime/configured-io.adapter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';

/** Глобальная настройка приложения. Используется и в main.ts, и в e2e-тестах. */
export function configureApp(app: INestApplication): void {
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, app.get(ConfigService)));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
