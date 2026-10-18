import { initTracing } from './tracing';
initTracing(); // must run first so HTTP instrumentation patches node's http module
// before anything else requires it

import { initSentry } from './sentry';
initSentry(); // must run before any other imports take effect

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { validateCorsConfig } from './cors';
import { validateInternalApiKeyConfig } from './admin/internal-key.guard';

// The only API bootstrap. Global pipes/filters/prefix live in configureApp so
// they can be asserted by request-validation/bootstrap.spec.ts without
// starting a server.
async function bootstrap() {
  validateCorsConfig();
  validateInternalApiKeyConfig();

  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupSwagger(app);

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
