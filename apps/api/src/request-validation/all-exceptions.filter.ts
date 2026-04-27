import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';
import { captureException } from '../sentry';
import {
  ErrorResponse,
  ValidationErrorResponse,
  ValidationFieldError,
} from './error-response.interface';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    const path = httpAdapter.getRequestUrl(ctx.getRequest<Request>()) as string;
    const timestamp = new Date().toISOString();
    const isProd = process.env.NODE_ENV === 'production';

    // ── HttpException (covers all NestJS built-ins + class-validator 400s) ──
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // class-validator fires a 400 with an array of messages
      if (statusCode === HttpStatus.BAD_REQUEST && typeof exceptionResponse === 'object') {
        const raw = exceptionResponse as Record<string, unknown>;

        if (Array.isArray(raw['message'])) {
          const validationErrors = this.parseValidationMessages(raw['message'] as string[]);

          const body: ValidationErrorResponse = {
            statusCode,
            message: 'Validation failed',
            error: 'Bad Request',
            timestamp,
            path,
            validationErrors,
          };

          this.logger.warn(`[400] Validation error at ${request.method} ${path}`, {
            validationErrors,
          });

          httpAdapter.reply(ctx.getResponse(), body, statusCode);
          return;
        }
      }

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : ((exceptionResponse as Record<string, unknown>)['message'] as string) ??
            exception.message;

      const error =
        typeof exceptionResponse === 'object'
          ? ((exceptionResponse as Record<string, unknown>)['error'] as string) ??
            this.statusToError(statusCode)
          : this.statusToError(statusCode);

      const body: ErrorResponse = {
        statusCode,
        message,
        error,
        timestamp,
        path,
      };

      if (statusCode >= 500) {
        this.logger.error(
          `[${statusCode}] ${request.method} ${path} — ${exception instanceof Error ? exception.message : 'HttpException'}`,
          exception instanceof Error ? exception.stack : undefined,
        );
      } else {
        this.logger.warn(`[${statusCode}] ${request.method} ${path} — ${message}`);
      }

      httpAdapter.reply(ctx.getResponse(), body, statusCode);
      return;
    }

    // ── Unhandled / unexpected exceptions ──
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

    captureException(exception, { path, method: request.method });

    this.logger.error(
      `[500] Unhandled exception at ${request.method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const body: ErrorResponse = {
      statusCode,
      message: isProd ? 'An unexpected error occurred' : this.safeMessage(exception),
      error: 'Internal Server Error',
      timestamp,
      path,
    };

    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * class-validator emits messages like "email must be an email" or
   * "username.minLength — username must be longer than or equal to 3 characters".
   * We reshape them into { field, constraints[] } pairs so the frontend can
   * surface per-field error messages.
   */
  private parseValidationMessages(messages: string[]): ValidationFieldError[] {
    const fieldMap = new Map<string, string[]>();

    for (const msg of messages) {
      // NestJS formats nested messages as "parent.child message"
      // Try to extract field name from the beginning of the message
      const dotIndex = msg.indexOf(' ');
      const field = dotIndex !== -1 ? msg.substring(0, dotIndex) : 'unknown';
      const constraint = dotIndex !== -1 ? msg.substring(dotIndex + 1) : msg;

      if (!fieldMap.has(field)) {
        fieldMap.set(field, []);
      }
      fieldMap.get(field)!.push(constraint);
    }

    return Array.from(fieldMap.entries()).map(([field, constraints]) => ({
      field,
      constraints,
    }));
  }

  private statusToError(status: number): string {
    const map: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return map[status] ?? 'Unknown Error';
  }

  private safeMessage(exception: unknown): string {
    if (exception instanceof Error) return exception.message;
    if (typeof exception === 'string') return exception;
    return 'An unexpected error occurred';
  }
}
