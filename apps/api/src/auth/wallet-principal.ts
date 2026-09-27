/**
 * Trusted wallet principal store (#1033).
 *
 * The principal for a request lives in a module-private WeakMap keyed by the
 * request object, not on a request property. Only code that imports
 * `attachWalletPrincipal` (i.e. a verifying guard such as JwtAuthGuard) can
 * write to it. Body parsers, query parsers, other middleware and anything
 * else that mutates `req.user` / `req.wallet` cannot forge a principal that
 * `@CurrentWallet()` will trust.
 *
 * WeakMap entries are released with the request, so there is no per-request
 * cleanup and no unbounded growth.
 */
export interface WalletPrincipal {
  /** Authenticated Stellar ed25519 public key (G...). */
  walletAddress: string;
  roles: string[];
  scopes: string[];
  correlationId: string;
}

const principals = new WeakMap<object, Readonly<WalletPrincipal>>();

export function attachWalletPrincipal(
  request: object,
  principal: WalletPrincipal,
): void {
  principals.set(
    request,
    Object.freeze({
      walletAddress: principal.walletAddress,
      roles: Object.freeze([...principal.roles]) as string[],
      scopes: Object.freeze([...principal.scopes]) as string[],
      correlationId: principal.correlationId,
    }),
  );
}

export function getWalletPrincipal(
  request: object,
): Readonly<WalletPrincipal> | undefined {
  return principals.get(request);
}
