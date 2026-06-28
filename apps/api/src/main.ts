import { initSentry } from './sentry';
initSentry(); // must run before any other imports take effect

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CompressionMiddleware } from './compression.middleware';
import { AllExceptionsFilter } from './request-validation/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter — ensures every error response (HttpException,
  // validation errors, and unhandled exceptions) shares a single consistent
  // JSON shape: { statusCode, message, error, timestamp, path }.
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  // Compression — applied globally, skips WebSocket and /health
  app.use(new CompressionMiddleware().use.bind(new CompressionMiddleware()));

  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Swyft API')
    .setDescription(
      'Concentrated liquidity DEX on Stellar - REST API documentation',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('docs-json', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
