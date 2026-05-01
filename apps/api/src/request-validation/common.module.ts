import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ValidationPipe } from '@nestjs/common';

/**
 * CommonModule
 *
 * Import this once in AppModule. It registers:
 *  - Global ValidationPipe (strips unknowns, whitelist, detailed messages)
 *  - Global AllExceptionsFilter
 *
 * Do NOT configure ValidationPipe a second time in main.ts if you import
 * this module; pick one location. The main.ts approach (see bootstrap comment)
 * is equally valid — use whichever fits your project convention.
 */
@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        stopAtFirstError: false,
        errorHttpStatusCode: 400,
      }),
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
  exports: [],
})
export class CommonModule {}
