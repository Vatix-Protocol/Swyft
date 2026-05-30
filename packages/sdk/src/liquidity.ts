export interface BurnTxParams {
  readonly positionId: string;
  readonly poolId: string;
  /** Basis points of total liquidity to remove (0–10000). */
  readonly liquidityBps: number;
  readonly ownerAddress: string;
}

export interface CollectTxParams {
  readonly positionId: string;
  readonly poolId: string;
  readonly ownerAddress: string;
}

/** Unsigned burn (remove-liquidity) transaction envelope. */
export interface BurnUnsignedTx {
  /** Base-64 encoded XDR envelope — stub value until Soroban sim is wired. */
  readonly xdr: string;
  readonly type: 'burn';
}

/** Unsigned collect-fees transaction envelope. */
export interface CollectUnsignedTx {
  /** Base-64 encoded XDR envelope — stub value until Soroban sim is wired. */
  readonly xdr: string;
  readonly type: 'collect';
}

/** Discriminated union of all unsigned liquidity-management transaction types. */
export type UnsignedTx = BurnUnsignedTx | CollectUnsignedTx;

/** Token amounts returned when removing liquidity. */
export interface RemoveAmountsResult {
  readonly amount0: string;
  readonly amount1: string;
}

/**
 * Builds an unsigned burn (remove liquidity) transaction XDR.
 * Stub — replace with real Soroban contract invocation via stellar-sdk.
 */
export function buildBurnTx(params: BurnTxParams): BurnUnsignedTx {
  const payload = JSON.stringify({ op: 'burn', ...params });
  const xdr = Buffer.from(payload).toString('base64');
  return { xdr, type: 'burn' };
}

/**
 * Builds an unsigned collect-fees transaction XDR.
 * Stub — replace with real Soroban contract invocation via stellar-sdk.
 */
export function buildCollectTx(params: CollectTxParams): CollectUnsignedTx {
  const payload = JSON.stringify({ op: 'collect', ...params });
  const xdr = Buffer.from(payload).toString('base64');
  return { xdr, type: 'collect' };
}

/**
 * Estimates token amounts returned for a given liquidity removal percentage.
 *
 * @param liquidity - Current position liquidity as a decimal string.
 * @param pct - Percentage of liquidity to remove (0–100).
 * @param currentPrice - Current pool price (token1/token0).
 * @param lowerTick - Lower tick bound of the position.
 * @param upperTick - Upper tick bound of the position.
 */
export function estimateRemoveAmounts(
  liquidity: string,
  pct: number,
  currentPrice: number,
  lowerTick: number,
  upperTick: number,
): RemoveAmountsResult {
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

/**
 * Async version of `estimateRemoveAmounts` that returns a Promise and can be
 * awaited by UIs that want to show a loading state while the math runs.
 * The computation is lightweight but wrapped in a microtask to allow
 * consumers to display spinners/skeletons.
 */
export async function estimateRemoveAmountsAsync(
  liquidity: string,
  pct: number,
  currentPrice: number,
  lowerTick: number,
  upperTick: number,
): Promise<RemoveAmountsResult> {
  return new Promise((resolve) => {
    // Defer to next tick so callers can render loading UI
    Promise.resolve().then(() => {
      resolve(estimateRemoveAmounts(liquidity, pct, currentPrice, lowerTick, upperTick));
    });
  });
}
