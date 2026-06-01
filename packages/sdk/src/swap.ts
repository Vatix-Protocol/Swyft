// ── Branded primitives ────────────────────────────────────────────────────────

/**
 * A Stellar / Soroban contract address (C… or G… strkey).
 * Using a branded type prevents accidentally passing a raw string where an
 * address is expected, and vice-versa.
 */
export type StellarAddress = string & { readonly __brand: "StellarAddress" };

/**
 * A raw token amount represented as a decimal string to avoid JS bigint loss.
 * Example: "1000000" (1 USDC with 6 decimals).
 */
export type RawAmount = string & { readonly __brand: "RawAmount" };

/**
 * A base-64 encoded Soroban XDR envelope string.
 */
export type XdrBase64 = string & { readonly __brand: "XdrBase64" };

// ── Helper casts ──────────────────────────────────────────────────────────────

/** Cast a plain string to {@link StellarAddress}. Use only at trust boundaries. */
export const toStellarAddress = (s: string): StellarAddress =>
  s as StellarAddress;

/** Cast a plain string to {@link RawAmount}. Use only at trust boundaries. */
export const toRawAmount = (s: string): RawAmount => s as RawAmount;

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Identifies a pool by its two token addresses. */
export interface PoolId {
  readonly token0: string;
  readonly token1: string;
}

/**
 * Parameters for building an exact-input single-hop swap transaction.
 *
 * @remarks
 * This interface is intended for a simplified swap builder and does not
 * include advanced route construction or multi-hop trade details.
 */
export interface SwapTxParams {
  /** On-chain pool contract address used to execute the swap. */
  readonly poolId: StellarAddress;
  /** Contract address of the token being sold. */
  readonly tokenInId: StellarAddress;
  /** Contract address of the token being bought. */
  readonly tokenOutId: StellarAddress;
  /** Raw amount of `tokenIn` to sell (as a string to avoid JS bigint loss). */
  readonly amountIn: RawAmount;
  /** Minimum amount of `tokenOut` that must be received after slippage. */
  readonly minimumReceived: RawAmount;
  /** Stellar account address of the transaction submitter / recipient. */
  readonly ownerAddress: StellarAddress;
}

/**
 * An unsigned Soroban swap transaction envelope ready for wallet signing.
 */
export interface SwapUnsignedTx {
  /** Base-64 encoded XDR of the transaction envelope. */
  readonly xdr: XdrBase64;
  /** Discriminant so callers can narrow the union type. */
  readonly type: 'swap';
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an unsigned swap transaction XDR from provided swap parameters.
 *
 * The returned transaction is a stub payload that should be replaced with a
 * real Soroban router invocation in production.
 *
 * @param params - Swap parameters including pool ID, token IDs, amounts, and owner.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  const payload = JSON.stringify({ op: 'swap', ...params });
  const xdr = btoa(payload) as XdrBase64;
  return { xdr, type: 'swap' };
}
