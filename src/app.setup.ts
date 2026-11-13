import { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';

/** Глобальная настройка приложения. Используется и в main.ts, и в e2e-тестах. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
