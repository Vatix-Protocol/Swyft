import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

const PLACEHOLDER_INTERNAL_API_KEY = 'change-me-in-production';

/**
 * Validate INTERNAL_API_KEY at startup (called in main.ts).
 * In production, refuses to boot if the key is unset or still the
 * placeholder from .env.example — /admin, indexer replay, and /metrics
 * must never silently reject (or silently accept) every caller.
 */
export function validateInternalApiKeyConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.INTERNAL_API_KEY;
    if (!key || key === PLACEHOLDER_INTERNAL_API_KEY) {
      throw new Error(
        'Production startup failed: INTERNAL_API_KEY must be set to a ' +
          'non-default value. It protects /admin, indexer replay, and ' +
          '/metrics endpoints.',
      );
    }
  }
}

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers['x-internal-key'] as string | undefined;
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException();
    return true;
  }
}
