import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Stable error codes surfaced by the wallet auth guard / decorator.
 * Kept in sync with `apps/api/src/auth/jwt-auth.guard.ts` so clients can
 * branch on a single, documented contract.
 */
export const WALLET_AUTH_ERROR_CODES = {
  MISSING_TOKEN: 'AUTH_MISSING_TOKEN',
  INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  EXPIRED_TOKEN: 'AUTH_EXPIRED_TOKEN',
  MISSING_WALLET: 'AUTH_MISSING_WALLET',
  INSUFFICIENT_SCOPE: 'AUTH_INSUFFICIENT_SCOPE',
} as const;

export type WalletAuthErrorCode =
  (typeof WALLET_AUTH_ERROR_CODES)[keyof typeof WALLET_AUTH_ERROR_CODES];

/**
 * Shape attached to the request by the JWT auth guard after a token has been
 * verified. `wallet` is the authenticated Stellar public key; `scopes` is the
 * deny-by-default authorization set granted to the token.
 */
export interface AuthenticatedWallet {
  wallet: string;
  scopes: string[];
  correlationId?: string;
}

/**
 * Reads the authenticated wallet from the request. The guard is the single
 * source of truth: if it did not run (or did not attach a wallet) we fail
 * closed rather than trusting anything the client sent.
 */
function readAuthenticatedWallet(
  request: Request & { wallet?: AuthenticatedWallet },
): AuthenticatedWallet {
  const auth = request.wallet;
  if (!auth || typeof auth.wallet !== 'string' || auth.wallet.length === 0) {
    throw new UnauthorizedException({
      code: WALLET_AUTH_ERROR_CODES.MISSING_WALLET,
      message: 'Authenticated wallet context is missing',
    });
  }
  return auth;
}

/**
 * Injects the authenticated wallet (or a single field of it) into a handler.
 *
 * Usage:
 *   @CurrentWallet() wallet: AuthenticatedWallet
 *   @CurrentWallet('wallet') wallet: string
 *
 * When `requiredScopes` is provided the decorator enforces deny-by-default
 * authorization: the token must carry every requested scope, otherwise the
 * request is rejected with a stable error code. This keeps untrusted clients
 * from bypassing policy even if a route forgets an explicit guard.
 */
export const CurrentWallet = createParamDecorator(
  (
    data: keyof AuthenticatedWallet | { scopes?: string[] } | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedWallet | string | string[] | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { wallet?: AuthenticatedWallet }>();

    const auth = readAuthenticatedWallet(request);

    const requiredScopes =
      data && typeof data === 'object' && Array.isArray(data.scopes)
        ? data.scopes
        : undefined;

    if (requiredScopes && requiredScopes.length > 0) {
      const granted = new Set(auth.scopes ?? []);
      const missing = requiredScopes.filter((scope) => !granted.has(scope));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: WALLET_AUTH_ERROR_CODES.INSUFFICIENT_SCOPE,
          message: 'Token is missing required scope(s)',
          missingScopes: missing,
          correlationId: auth.correlationId,
        });
      }
    }

    if (typeof data === 'string') {
      return auth[data];
    }

    return auth;
  },
);
