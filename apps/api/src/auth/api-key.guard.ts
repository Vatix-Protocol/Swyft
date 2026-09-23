import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stable error codes for fee-collector auth failures. Clients can branch on
 * these without parsing human-readable messages.
 */
export const FEE_COLLECTOR_AUTH_ERRORS = {
  MISSING_KEY: 'FEE_COLLECTOR_AUTH_MISSING_KEY',
  INVALID_KEY: 'FEE_COLLECTOR_AUTH_INVALID_KEY',
  EXPIRED_KEY: 'FEE_COLLECTOR_AUTH_EXPIRED_KEY',
  WRONG_ROLE: 'FEE_COLLECTOR_AUTH_WRONG_ROLE',
  DEPENDENCY_UNAVAILABLE: 'FEE_COLLECTOR_AUTH_DEPENDENCY_UNAVAILABLE',
} as const;

/**
 * Role required to invoke fee-collector money-path entrypoints. Deny-by-default:
 * a key without this role cannot reach the handler.
 */
export const FEE_COLLECTOR_ROLE = 'fee_collector';

/**
 * Marks a route as a fee-collector money path. The guard enforces the
 * FEE_COLLECTOR_AUTH role/expiry policy for any handler carrying this metadata.
 */
export const FEE_COLLECTOR_AUTH = 'FEE_COLLECTOR_AUTH';

export const FeeCollectorAuth = (): MethodDecorator =>
  SetMetadata(FEE_COLLECTOR_AUTH, true);

interface RequestWithUser {
  headers: { 'x-api-key'?: string; 'x-correlation-id'?: string };
  user?: {
    walletAddress: string;
    apiKeyId: string;
    role: string;
    correlationId: string;
  };
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();

    // Correlation id is propagated for observability; never derived from secrets.
    const correlationId =
      req.headers['x-correlation-id'] ?? randomUUID();
    req.correlationId = correlationId;

    const raw = req.headers['x-api-key'];
    const correlationId =
      req.headers['x-correlation-id'] ?? createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 16);

    if (!raw) {
      throw new UnauthorizedException({
        code: FEE_COLLECTOR_AUTH_ERRORS.MISSING_KEY,
        message: 'Missing X-Api-Key header',
        correlationId,
      });
    }

    const hashed = createHash('sha256').update(raw).digest('hex');

    let record: {
      id: string;
      ownerWallet: string;
      revoked: boolean;
      role?: string;
      expiresAt?: Date | null;
    } | null;

    try {
      record = await this.prisma.apiKey.findUnique({
        where: { hashedKey: hashed },
      });
    } catch {
      // Fail-closed: if the auth store is unavailable we must not allow writes.
      throw new UnauthorizedException({
        code: FEE_COLLECTOR_AUTH_ERRORS.DEPENDENCY_UNAVAILABLE,
        message: 'Auth store unavailable',
        correlationId,
      });
    }

    if (!record || record.revoked) {
      throw new UnauthorizedException({
        code: FEE_COLLECTOR_AUTH_ERRORS.INVALID_KEY,
        message: 'Invalid or revoked API key',
        correlationId,
      });
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: FEE_COLLECTOR_AUTH_ERRORS.EXPIRED_KEY,
        message: 'API key expired',
        correlationId,
      });
    }

    const requiresFeeCollector = this.reflector.getAllAndOverride<boolean>(
      FEE_COLLECTOR_AUTH,
      [context.getHandler(), context.getClass()],
    );

    if (requiresFeeCollector && record.role !== FEE_COLLECTOR_ROLE) {
      throw new ForbiddenException({
        code: FEE_COLLECTOR_AUTH_ERRORS.WRONG_ROLE,
        message: 'API key lacks fee_collector role',
        correlationId,
      });
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

    req.user = {
      walletAddress: record.ownerWallet,
      apiKeyId: record.id,
      role: record.role ?? 'default',
      correlationId,
    };
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
