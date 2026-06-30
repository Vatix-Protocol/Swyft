import { Account, Contract, Keypair, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "./config";

export interface BurnTxParams {
  readonly positionId: string;
  readonly poolId: string;
  readonly liquidity: string;
  /** Basis points of total liquidity to remove (0–10000). */
  readonly liquidityBps: number;
  readonly ownerAddress: string;
}

export interface CollectTxParams {
  readonly positionId: string;
  readonly poolId: string;
  readonly ownerAddress: string;
  /** Stellar wallet address of the fee collector. */
  readonly ownerWallet: string;
}

function isValidStellarAddress(address: string): boolean {
  return typeof address === 'string' && address.length === 56 && address.startsWith('G');
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Unsigned burn (remove-liquidity) transaction envelope. */
export interface BurnUnsignedTx {
  /** Base-64 encoded XDR envelope. */
  readonly xdr: string;
  readonly type: 'burn';
}

/** Unsigned collect-fees transaction envelope. */
export interface CollectUnsignedTx {
  /** Base-64 encoded XDR envelope. */
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
 *
 * Constructs a Soroban contract invocation that calls the remove_liquidity function to
 * remove liquidity from a position.
 *
 * @param params - Burn parameters including position ID, pool ID, liquidity amount, and owner.
 * @returns An unsigned burn transaction envelope in base-64 XDR format.
 *
 * @throws If parameters are invalid (empty IDs, invalid liquidity basis points, etc.).
 */
export function buildBurnTx(params: BurnTxParams): BurnUnsignedTx {
  if (
    !params.positionId ||
    !params.poolId ||
    !params.liquidity ||
    params.liquidityBps < 0 ||
    params.liquidityBps > 10000 ||
    !params.ownerAddress
  ) {
    throw new Error(
      'Invalid burn parameters: all fields are required, liquidityBps must be 0-10000'
    );
  }

  const contract = new Contract(params.poolId);
  
  const totalLiquidity = BigInt(params.liquidity.split('.')[0]); // handle potential decimals just in case
  const liquidityToRemove = (totalLiquidity * BigInt(params.liquidityBps)) / 10000n;

  const ownerScVal = nativeToScVal(params.ownerAddress, { type: "address" });
  const positionIdScVal = nativeToScVal(params.positionId, { type: "u64" });
  const liquidityToRemoveScVal = nativeToScVal(liquidityToRemove.toString(), { type: "u128" });

  const burnOp = contract.call("remove_liquidity", ownerScVal, positionIdScVal, liquidityToRemoveScVal);

  const sourceKeypair = Keypair.random();
  const sourceAccount = new Account(sourceKeypair.publicKey(), "0");

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: config.networkPassphrase,
  });

  txBuilder.addOperation(burnOp);
  const tx = txBuilder.setTimeout(30).build();
  const xdr = tx.toEnvelope().toXDR("base64");

  return { xdr, type: 'burn' };
}

/**
 * Builds an unsigned collect-fees transaction XDR.
 * Constructs a real Soroban contract invocation.
 *
 * @throws {ValidationError} If ownerWallet is not a valid Stellar address
 */
export function buildCollectTx(params: CollectTxParams): CollectUnsignedTx {
  if (!params.ownerWallet) {
    throw new ValidationError('ownerWallet is required');
  }
  if (!isValidStellarAddress(params.ownerWallet)) {
    throw new ValidationError(
      `ownerWallet must be a valid Stellar address (starts with G, 56 chars). Got: ${params.ownerWallet}`
    );
  }

  const contract = new Contract(params.poolId);
  const ownerScVal = nativeToScVal(params.ownerAddress || params.ownerWallet, { type: "address" });
  const positionIdScVal = nativeToScVal(params.positionId, { type: "u64" });

  const collectOp = contract.call("collect", ownerScVal, positionIdScVal);

  const sourceKeypair = Keypair.random();
  const sourceAccount = new Account(sourceKeypair.publicKey(), "0");

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: config.networkPassphrase,
  });

  txBuilder.addOperation(collectOp);
  const tx = txBuilder.setTimeout(30).build();
  const xdr = tx.toEnvelope().toXDR("base64");

  return { xdr, type: 'collect' };
}

/**
 * Parameters for estimating token amounts returned from a liquidity removal.
 */
export interface RemoveAmountsParams {
  /** Current position liquidity as a decimal string. */
  readonly liquidity: string;
  /** Percentage of liquidity to remove (0–100). */
  readonly pct: number;
  /** Current pool price (token1/token0). */
  readonly currentPrice: number;
  /** Lower tick bound of the position. */
  readonly lowerTick: number;
  /** Upper tick bound of the position. */
  readonly upperTick: number;
}

/**
 * Estimates token amounts returned for a given liquidity removal percentage.
 *
 * @param params - The removal parameters.
 * @returns Estimated token amounts as fixed-point strings (7 decimals).
 * @throws {RangeError} If `pct` is outside the 0–100 range.
 * @throws {RangeError} If `liquidity` cannot be parsed as a finite number.
 *
 * @example
 * ```ts
 * const result = estimateRemoveAmounts({
 *   liquidity: '1000000',
 *   pct: 50,
 *   currentPrice: 1.5,
 *   lowerTick: -1000,
 *   upperTick: 1000,
 * });
 * ```
 */
export function estimateRemoveAmounts({
  liquidity,
  pct,
  currentPrice,
  lowerTick,
  upperTick,
}: RemoveAmountsParams): RemoveAmountsResult {
  if (pct < 0 || pct > 100) {
    throw new RangeError('pct must be between 0 and 100');
  }
  const liq = parseFloat(liquidity);
  if (!Number.isFinite(liq)) {
    throw new RangeError('liquidity must be a finite number');
  }
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
 * Async version of {@link estimateRemoveAmounts} that returns a Promise and
 * can be awaited by UIs that want to show a loading state while the math runs.
 * The computation is lightweight but wrapped in a microtask to allow
 * consumers to display spinners/skeletons.
 *
 * @param params - The removal parameters (same as {@link estimateRemoveAmounts}).
 */
export async function estimateRemoveAmountsAsync(
  params: RemoveAmountsParams
): Promise<RemoveAmountsResult> {
  return new Promise((resolve) => {
    // Defer to next tick so callers can render loading UI
    Promise.resolve().then(() => {
      resolve(estimateRemoveAmounts(params));
    });
  });
}
