import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import { Request } from 'express';
import { BoundedCounter } from '../observability/bounded-counter';
import { resolveCorrelationId } from '../observability/correlation-id';
import { getWalletPrincipal, WalletPrincipal } from './wallet-principal';

/**
 * Current-wallet decorator trust boundaries (#1033).
 *
 * Invariants:
 *  - The only trusted source of the caller's wallet is the principal attached
 *    by a verifying guard via `attachWalletPrincipal` (see
 *    `wallet-principal.ts`). `req.user`, `req.wallet`, headers, query and
 *    body are never read, so a client cannot choose whose wallet a handler
 *    acts on.
 *  - Fail-closed: no principal, or a principal whose address is not a valid
 *    Stellar ed25519 public key, rejects with 401 before the handler runs.
 *  - Deny-by-default: when `scopes` / `roles` are requested the principal
 *    must carry every scope and at least one of the roles, otherwise 403.
 *  - Errors carry a stable `code` and a `correlationId`, never the token or
 *    the wallet address.
 *
 * See apps/api/src/auth/AUTH_FLOW.md#current-wallet-decorator.
 */
export const WALLET_AUTH_ERROR_CODES = {
  MISSING_WALLET: 'AUTH_MISSING_WALLET',
  INVALID_WALLET: 'AUTH_INVALID_WALLET',
  INSUFFICIENT_SCOPE: 'AUTH_INSUFFICIENT_SCOPE',
  INSUFFICIENT_ROLE: 'AUTH_INSUFFICIENT_ROLE',
} as const;

export type WalletAuthErrorCode =
  (typeof WALLET_AUTH_ERROR_CODES)[keyof typeof WALLET_AUTH_ERROR_CODES];

export type AuthenticatedWallet = Readonly<WalletPrincipal>;

export interface CurrentWalletOptions {
  /** Every listed scope must be granted to the token. */
  scopes?: string[];
  /** At least one listed role must be granted to the token. */
  roles?: string[];
}

/**
 * Outcome counter for the decorator. Labels are the fixed outcome set, never
 * wallet addresses or correlation ids.
 */
export const currentWalletOutcomes = new BoundedCounter('current_wallet_outcomes', [
  'allowed',
  WALLET_AUTH_ERROR_CODES.MISSING_WALLET,
  WALLET_AUTH_ERROR_CODES.INVALID_WALLET,
  WALLET_AUTH_ERROR_CODES.INSUFFICIENT_SCOPE,
  WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE,
] as const);

const logger = new Logger('CurrentWallet');

function deny(
  code: WalletAuthErrorCode,
  correlationId: string,
): UnauthorizedException | ForbiddenException {
  currentWalletOutcomes.inc(code);
  logger.warn(`[${correlationId}] current-wallet denied code=${code}`);
  const body = { code, message: 'Unauthorized', correlationId };
  return code === WALLET_AUTH_ERROR_CODES.INSUFFICIENT_SCOPE ||
    code === WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE
    ? new ForbiddenException({ ...body, message: 'Forbidden' })
    : new UnauthorizedException(body);
}

/**
 * Resolves and authorizes the trusted principal for a request. Exported so
 * the policy can be unit-tested without the Nest param-decorator plumbing.
 */
export function resolveWalletPrincipal(
  request: Request,
  options: CurrentWalletOptions | undefined,
): AuthenticatedWallet {
  const principal = getWalletPrincipal(request);
  if (!principal) {
    throw deny(
      WALLET_AUTH_ERROR_CODES.MISSING_WALLET,
      resolveCorrelationId(request.headers),
    );
  }

  const { correlationId } = principal;
  if (
    typeof principal.walletAddress !== 'string' ||
    !StrKey.isValidEd25519PublicKey(principal.walletAddress)
  ) {
    throw deny(WALLET_AUTH_ERROR_CODES.INVALID_WALLET, correlationId);
  }

  const requiredScopes = options?.scopes ?? [];
  if (requiredScopes.some((scope) => !principal.scopes.includes(scope))) {
    throw deny(WALLET_AUTH_ERROR_CODES.INSUFFICIENT_SCOPE, correlationId);
  }

  const allowedRoles = options?.roles ?? [];
  if (
    allowedRoles.length > 0 &&
    !allowedRoles.some((role) => principal.roles.includes(role))
  ) {
    throw deny(WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE, correlationId);
  }

  currentWalletOutcomes.inc('allowed');
  return principal;
}

/**
 * Injects the authenticated wallet address (a Stellar G... public key).
 *
 *   @CurrentWallet() wallet: string
 *   @CurrentWallet({ scopes: ['positions:read'] }) wallet: string
 *
 * Must be used on a route protected by a guard that calls
 * `attachWalletPrincipal` (JwtAuthGuard); otherwise every call fails closed.
 */
export const CurrentWallet = createParamDecorator(
  (options: CurrentWalletOptions | undefined, ctx: ExecutionContext): string =>
    resolveWalletPrincipal(ctx.switchToHttp().getRequest<Request>(), options)
      .walletAddress,
);

/**
 * Same trust rules as `@CurrentWallet()`, but injects the full frozen
 * principal (address, roles, scopes, correlationId).
 */
export const CurrentWalletPrincipal = createParamDecorator(
  (
    options: CurrentWalletOptions | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedWallet =>
    resolveWalletPrincipal(ctx.switchToHttp().getRequest<Request>(), options),
);
