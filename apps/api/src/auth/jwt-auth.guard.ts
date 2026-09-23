import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verify, VerifyOptions } from 'jsonwebtoken';

interface JwtPayload {
  sub?: string;
  walletAddress?: string;
  wallet?: string;
  address?: string;
  role?: string;
  roles?: string[];
  scope?: string | string[];
  iss?: string;
  aud?: string | string[];
  role?: string;
  roles?: string[];
  exp?: number;
}

interface RequestWithUser {
  headers: { authorization?: string };
  user?: { walletAddress: string; roles: string[]; scopes: string[] };
}

/**
 * Stable, non-leaking error codes surfaced to clients. The message is kept
 * generic so token contents / claim values are never echoed back.
 */
const AUTH_ERROR_CODES = {
  MISSING_HEADER: 'AUTH_MISSING_HEADER',
  MISSING_TOKEN: 'AUTH_MISSING_TOKEN',
  NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  MISSING_WALLET: 'AUTH_MISSING_WALLET',
  FORBIDDEN: 'AUTH_FORBIDDEN',
} as const;

/**
 * Roles permitted to invoke the fee-collector money path.
 * Deny-by-default: any token without one of these roles is rejected.
 */
const FEE_COLLECTOR_ROLES = ['fee-collector', 'admin'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const correlationId = this.resolveCorrelationId(req);

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw this.deny(AUTH_ERROR_CODES.MISSING_HEADER, correlationId);
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw this.deny(AUTH_ERROR_CODES.MISSING_TOKEN, correlationId);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Fail closed: never fall back to an unverified/unsigned path.
      this.logger.error(
        `[${correlationId}] JWT secret not configured; denying request`,
      );
      throw this.deny(AUTH_ERROR_CODES.NOT_CONFIGURED, correlationId);
    }

    const options: VerifyOptions = {
      // Reject unsigned/algorithm-confused tokens by pinning the algorithm.
      algorithms: ['HS256'],
    };
    if (process.env.JWT_ISSUER) {
      options.issuer = process.env.JWT_ISSUER;
    }
    if (process.env.JWT_AUDIENCE) {
      options.audience = process.env.JWT_AUDIENCE;
    }

    let payload: JwtPayload;
    try {
      // jsonwebtoken enforces exp/nbf by default; expired tokens throw here.
      payload = verify(token, secret, options) as JwtPayload;
    } catch {
      // Do not log the token or the underlying error detail.
      this.logger.warn(`[${correlationId}] JWT verification failed`);
      throw this.deny(AUTH_ERROR_CODES.INVALID_TOKEN, correlationId);
    }

    // Fail-closed on expiry: reject tokens without a valid future exp claim.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      throw this.deny(AUTH_ERROR_CODES.INVALID_TOKEN, correlationId);
    }
    const walletAddress =
      payload.walletAddress ??
      payload.wallet ??
      payload.address ??
      payload.sub;

    if (!walletAddress || typeof walletAddress !== 'string') {
      this.logger.warn(`[${correlationId}] JWT missing wallet address claim`);
      throw this.deny(AUTH_ERROR_CODES.MISSING_WALLET, correlationId);
    }

    const roles = this.normalizeList(payload.roles ?? payload.role);
    const scopes = this.normalizeList(payload.scope);

    // Deny-by-default: a token must carry at least one role or scope to be
    // usable on privileged surfaces. Untrusted clients cannot bypass policy
    // by presenting a wallet-only token.
    if (roles.length === 0 && scopes.length === 0) {
      this.logger.warn(
        `[${correlationId}] JWT lacks role/scope claims; denying by default`,
      );
      throw this.deny(AUTH_ERROR_CODES.FORBIDDEN, correlationId);
    }

    // Fee-collector money path requires an explicit privileged role.
    if (
      roles.length > 0 &&
      !roles.some((role) => FEE_COLLECTOR_ROLES.includes(role))
    ) {
      this.logger.warn(
        `[${correlationId}] JWT lacks fee-collector role; denying by default`,
      );
      throw this.deny(AUTH_ERROR_CODES.FORBIDDEN, correlationId);
    }

    req.user = { walletAddress, roles, scopes };
    return true;
  }

  private normalizeList(value?: string | string[]): string[] {
    if (!value) {
      return [];
    }
    const list = Array.isArray(value) ? value : [value];
    return list.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  }

  private resolveCorrelationId(req: RequestWithUser): string {
    const headers = req.headers as Record<string, string | undefined>;
    return (
      headers['x-correlation-id'] ??
      headers['x-request-id'] ??
      'unknown'
    );
  }

  private deny(code: string, correlationId: string): UnauthorizedException {
    return new UnauthorizedException({
      code,
      message: 'Unauthorized',
      correlationId,
    });
  }
}
