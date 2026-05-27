/** Identifies a pool by its two token addresses. */
export interface PoolId {
  token0: string;
  token1: string;
}

/** Parameters for building an exact-input single-hop swap transaction. */
export interface SwapTxParams {
  /** On-chain pool contract address. */
  poolId: string;
  /** Contract address of the token being sold. */
  tokenInId: string;
  /** Contract address of the token being bought. */
  tokenOutId: string;
  /** Raw amount of `tokenIn` to sell (as a string to avoid JS bigint loss). */
  amountIn: string;
  /** Slippage-adjusted minimum amount of `tokenOut` to receive. */
  minimumReceived: string;
  /** Stellar account address of the transaction submitter / recipient. */
  ownerAddress: string;
}

/** An unsigned Soroban transaction envelope ready for wallet signing. */
export interface SwapUnsignedTx {
  /** Base-64 encoded XDR of the transaction envelope. */
  xdr: string;
  /** Discriminant so callers can narrow the union type. */
  type: "swap";
}

/**
 * Builds an unsigned swap transaction XDR.
 * Stub — replace with real Soroban router contract invocation via stellar-sdk.
 *
 * @param params - Swap parameters including pool, tokens, amounts, and signer.
 * @returns An unsigned transaction envelope in XDR format.
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  const payload = JSON.stringify({ op: "swap", ...params });
  const xdr = Buffer.from(payload).toString("base64");
  return { xdr, type: "swap" };
}
