import { initSentry } from './sentry';
initSentry(); // must run before any other imports take effect

import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CompressionMiddleware } from './compression.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  // Compression — applied globally, skips WebSocket and /health
  app.use(new CompressionMiddleware().use.bind(new CompressionMiddleware()));

  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Swyft API')
    .setDescription('Concentrated liquidity DEX on Stellar - REST API documentation')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('docs-json', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
