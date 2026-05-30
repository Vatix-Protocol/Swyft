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

/** Parameters for building an exact-input single-hop swap transaction. */
export interface SwapTxParams {
  /** On-chain pool contract address. */
  readonly poolId: string;
  /** Contract address of the token being sold. */
  readonly tokenInId: string;
  /** Contract address of the token being bought. */
  readonly tokenOutId: string;
  /** Raw amount of `tokenIn` to sell (as a string to avoid JS bigint loss). */
  readonly amountIn: string;
  /** Slippage-adjusted minimum amount of `tokenOut` to receive. */
  readonly minimumReceived: string;
  /** Stellar account address of the transaction submitter / recipient. */
  readonly ownerAddress: string;
}

/** An unsigned Soroban transaction envelope ready for wallet signing. */
export interface SwapUnsignedTx {
  /** Base-64 encoded XDR of the transaction envelope. */
  readonly xdr: string;
  /** Discriminant so callers can narrow the union type. */
  readonly type: 'swap';
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an unsigned swap transaction XDR.
 * Stub — replace with real Soroban router contract invocation via stellar-sdk.
 *
 * @param params - Swap parameters including pool, tokens, amounts, and signer.
 * @returns An unsigned transaction envelope in XDR format.
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  const payload = JSON.stringify({ op: 'swap', ...params });
  const xdr = btoa(payload);
  return { xdr, type: 'swap' };
}
