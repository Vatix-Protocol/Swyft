import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Stable error codes for privileged admin analytics surfaces.
 * Deny-by-default: any failure to prove a valid internal key is rejected.
 */
export const INTERNAL_KEY_ERROR_CODES = {
  MISSING_KEY: 'ADMIN_INTERNAL_KEY_MISSING',
  INVALID_KEY: 'ADMIN_INTERNAL_KEY_INVALID',
  NOT_CONFIGURED: 'ADMIN_INTERNAL_KEY_NOT_CONFIGURED',
} as const;

export type InternalKeyErrorCode =
  (typeof INTERNAL_KEY_ERROR_CODES)[keyof typeof INTERNAL_KEY_ERROR_CODES];

/**
 * Constant-time comparison that never throws on length mismatch and never
 * leaks key material. Returns false for any malformed input.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined);

    const raw = req.headers['x-internal-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const expected = process.env.INTERNAL_API_KEY;

    // Fail-closed: if the server has no key configured, deny everything.
    if (!expected) {
      this.logger.error(
        `Internal key not configured; denying admin request${correlationId ? ` correlationId=${correlationId}` : ''}`,
      );
      throw new UnauthorizedException({
        code: INTERNAL_KEY_ERROR_CODES.NOT_CONFIGURED,
        message: 'Internal key not configured',
        correlationId,
      });
    }

    if (!key) {
      this.logger.warn(
        `Missing internal key on admin request${correlationId ? ` correlationId=${correlationId}` : ''}`,
      );
      throw new UnauthorizedException({
        code: INTERNAL_KEY_ERROR_CODES.MISSING_KEY,
        message: 'Missing internal key',
        correlationId,
      });
    }

    if (!safeEqual(key, expected)) {
      this.logger.warn(
        `Invalid internal key on admin request${correlationId ? ` correlationId=${correlationId}` : ''}`,
      );
      throw new UnauthorizedException({
        code: INTERNAL_KEY_ERROR_CODES.INVALID_KEY,
        message: 'Invalid internal key',
        correlationId,
      });
    }

    return true;
  }
}
