import { NestFactory } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // Suppress the default NestJS exception logging so our filter owns all log output
    bufferLogs: true,
  });

  // ── Global prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Global exception filter ───────────────────────────────────────────────
  // HttpAdapterHost is required so the filter can call httpAdapter.reply()
  // regardless of underlying platform (Express / Fastify).
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  // ── NOTE on ValidationPipe ────────────────────────────────────────────────
  // If you are NOT using CommonModule's APP_PIPE registration, uncomment below:
  //
  // import { ValidationPipe } from '@nestjs/common';
  // app.useGlobalPipes(
  //   new ValidationPipe({
  //     whitelist: true,              // strip properties with no decorator
  //     forbidNonWhitelisted: true,   // throw 400 when unknown props are sent
  //     transform: true,              // auto-transform payloads to DTO instances
  //     transformOptions: { enableImplicitConversion: false },
  //     stopAtFirstError: false,      // collect ALL field errors before throwing
  //     errorHttpStatusCode: 400,
  //   }),
  // );
  //
  // Only enable one of: APP_PIPE in CommonModule OR useGlobalPipes here.

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`🚀 API running on http://localhost:${port}/api/v1`);
}

bootstrap();
