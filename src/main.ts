import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get(ConfigService);

  const origins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({ origin: origins, credentials: true });

  if (config.getOrThrow<string>('SWAGGER_ENABLED') === 'true') {
    setupSwagger(app);
  }

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  Logger.log(`Backend:  http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Health:   http://localhost:${port}/health`, 'Bootstrap');
  Logger.log(`Swagger:  http://localhost:${port}/docs`, 'Bootstrap');
}

void bootstrap();
