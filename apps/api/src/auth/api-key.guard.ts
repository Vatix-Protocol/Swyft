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

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
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

    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    req.user = {
      walletAddress: record.ownerWallet,
      apiKeyId: record.id,
      role: record.role ?? 'default',
      correlationId,
    };
    return true;
  }
}
