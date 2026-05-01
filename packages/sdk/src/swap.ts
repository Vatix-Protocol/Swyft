export interface SwapTxParams {
  poolId: string;
  tokenInId: string;
  tokenOutId: string;
  amountIn: string;
  minimumReceived: string; // slippage-adjusted minimum out
  ownerAddress: string;
}

export interface SwapUnsignedTx {
  xdr: string;
  type: "swap";
}

/**
 * Builds an unsigned swap transaction XDR.
 * Stub — replace with real Soroban router contract invocation via stellar-sdk.
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  const payload = JSON.stringify({ op: "swap", ...params });
  const xdr = Buffer.from(payload).toString("base64");
  return { xdr, type: "swap" };
}
