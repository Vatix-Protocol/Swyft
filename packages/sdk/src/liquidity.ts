export interface BurnTxParams {
  positionId: string;
  poolId: string;
  liquidityBps: number; // 0–10000, basis points of total liquidity to remove
  ownerAddress: string;
}

export interface CollectTxParams {
  positionId: string;
  poolId: string;
  ownerAddress: string;
}

export interface UnsignedTx {
  xdr: string; // base64 XDR envelope — stub value until Soroban sim is wired
  type: "burn" | "collect";
}

/**
 * Builds an unsigned burn (remove liquidity) transaction XDR.
 * Stub — replace with real Soroban contract invocation via stellar-sdk.
 */
export function buildBurnTx(params: BurnTxParams): UnsignedTx {
  const payload = JSON.stringify({ op: "burn", ...params });
  const xdr = Buffer.from(payload).toString("base64");
  return { xdr, type: "burn" };
}

/**
 * Builds an unsigned collect-fees transaction XDR.
 * Stub — replace with real Soroban contract invocation via stellar-sdk.
 */
export function buildCollectTx(params: CollectTxParams): UnsignedTx {
  const payload = JSON.stringify({ op: "collect", ...params });
  const xdr = Buffer.from(payload).toString("base64");
  return { xdr, type: "collect" };
}

/** Estimate token amounts returned for a given liquidity removal percentage. */
export function estimateRemoveAmounts(
  liquidity: string,
  pct: number, // 0–100
  currentPrice: number,
  lowerTick: number,
  upperTick: number
): { amount0: string; amount1: string } {
  const liq = parseFloat(liquidity);
  const fraction = pct / 100;

  // Simplified geometric approximation — replace with full tick math in SDK v1
  const sqrtPrice = Math.sqrt(currentPrice);
  const sqrtLower = Math.sqrt(Math.pow(1.0001, lowerTick));
  const sqrtUpper = Math.sqrt(Math.pow(1.0001, upperTick));

  let amount0 = 0;
  let amount1 = 0;

  if (sqrtPrice <= sqrtLower) {
    amount0 = liq * fraction * (1 / sqrtLower - 1 / sqrtUpper);
  } else if (sqrtPrice >= sqrtUpper) {
    amount1 = liq * fraction * (sqrtUpper - sqrtLower);
  } else {
    amount0 = liq * fraction * (1 / sqrtPrice - 1 / sqrtUpper);
    amount1 = liq * fraction * (sqrtPrice - sqrtLower);
  }

  return {
    amount0: Math.max(0, amount0).toFixed(7),
    amount1: Math.max(0, amount1).toFixed(7),
  };
}
