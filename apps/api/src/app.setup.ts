import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CompressionMiddleware } from './compression.middleware';
import { getCorsOrigins } from './cors';
import { AllExceptionsFilter } from './request-validation/all-exceptions.filter';

/**
 * Applies the global request pipeline (CORS, validation, exception filter,
 * WebSocket adapter, route prefix, compression) to an application instance.
 *
 * This is the single place the pipeline is configured. `main.ts` is the only
 * bootstrap entrypoint and calls this; specs call it on a test app so the
 * registered filters/pipes match production exactly.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.enableCors({ origin: getCorsOrigins(), credentials: true });
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

  // Version all public REST routes under /v1 (e.g. GET /v1/pools).
  // WebSocket, /health, and /docs remain at root — they are not affected
  // because they are registered before the prefix takes effect or are
  // excluded via NestJS route exclusion patterns.
  app.setGlobalPrefix('v1', {
    exclude: ['health', 'docs', 'docs-json', '/'],
  });

  // Compression — applied globally, skips WebSocket and /health
  app.use(new CompressionMiddleware().use.bind(new CompressionMiddleware()));

  return app;
}

/** Mounts the Swagger UI and JSON document. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Swyft API')
    .setDescription(
      'Concentrated liquidity DEX on Stellar - REST API documentation',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('docs-json', app, document);
}
