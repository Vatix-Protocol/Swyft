import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

interface RequestWithUser {
  headers: { 'x-api-key'?: string; 'x-correlation-id'?: string };
  user?: { walletAddress: string; apiKeyId: string };
  correlationId?: string;
}

/**
 * Stable error codes for API-key authentication failures.
 * See docs/RATE_LIMITING.md for the deny-by-default policy.
 */
export const API_KEY_ERROR_CODES = {
  MISSING_KEY: 'AUTH_MISSING_API_KEY',
  INVALID_KEY: 'AUTH_INVALID_API_KEY',
  BACKING_STORE_UNAVAILABLE: 'AUTH_BACKING_STORE_UNAVAILABLE',
} as const;

export type ApiKeyErrorCode =
  (typeof API_KEY_ERROR_CODES)[keyof typeof API_KEY_ERROR_CODES];

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();

    // Correlation id is propagated for observability; never derived from secrets.
    const correlationId =
      req.headers['x-correlation-id'] ?? randomUUID();
    req.correlationId = correlationId;

    const raw = req.headers['x-api-key'];

    if (!raw) {
      throw this.fail(
        API_KEY_ERROR_CODES.MISSING_KEY,
        'Missing X-Api-Key header',
        correlationId,
      );
    }

    const hashed = createHash('sha256').update(raw).digest('hex');

    let record: Awaited<
      ReturnType<PrismaService['apiKey']['findUnique']>
    >;
    try {
      record = await this.prisma.apiKey.findUnique({
        where: { hashedKey: hashed },
      });
    } catch {
      // Fail-closed: if the backing store is unavailable we deny the request
      // rather than allowing an unauthenticated caller through.
      throw this.fail(
        API_KEY_ERROR_CODES.BACKING_STORE_UNAVAILABLE,
        'Authentication backing store unavailable',
        correlationId,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!record || record.revoked) {
      throw this.fail(
        API_KEY_ERROR_CODES.INVALID_KEY,
        'Invalid or revoked API key',
        correlationId,
      );
    }

    try {
      await this.prisma.apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // lastUsedAt is best-effort telemetry; a write failure must not grant
      // access, but the key itself is already validated above.
    }

    req.user = { walletAddress: record.ownerWallet, apiKeyId: record.id };
    return true;
  }

  private fail(
    code: ApiKeyErrorCode,
    message: string,
    correlationId: string,
    status: HttpStatus = HttpStatus.UNAUTHORIZED,
  ): HttpException {
    if (status === HttpStatus.UNAUTHORIZED) {
      return new UnauthorizedException({
        code,
        message,
        correlationId,
      });
    }
    return new HttpException(
      { code, message, correlationId },
      status,
    );
  }
}
