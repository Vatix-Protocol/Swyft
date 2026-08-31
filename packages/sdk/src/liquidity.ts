import { Account, Contract, Keypair, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "./config";
import { callContract } from "./queries";

/** Discriminant for which pool contract ABI to target. */
export type PoolType = 'pool' | 'cl_pool';

/**
 * Detects the pool contract type by calling its `name()` method.
 *
 * @param rpcUrl - Soroban RPC URL
 * @param poolAddress - Contract address of the pool
 * @returns The detected pool type ('pool' or 'cl_pool')
 * @throws If the RPC call fails or returns an unexpected name
 */
export async function detectPoolType(rpcUrl: string, poolAddress: string): Promise<PoolType> {
  const retval = await callContract(rpcUrl, poolAddress, 'name');
  const name = String(retval);
  if (name === 'cl_pool') return 'cl_pool';
  if (name === 'pool') return 'pool';
  throw new Error(`Unknown pool type: ${name}`);
}

export interface BurnTxParams {
  readonly positionId: string;
  readonly poolId: string;
  readonly liquidity: string;
  /** Basis points of total liquidity to remove (0–10000). */
  readonly liquidityBps: number;
  readonly ownerAddress: string;
  /** Pool contract type. If not provided, defaults to 'pool' (burn method). */
  readonly poolType?: PoolType;
}

export interface CollectTxParams {
  readonly positionId: string;
  readonly poolId: string;
  readonly ownerAddress: string;
  /** Stellar wallet address of the fee collector. */
  readonly ownerWallet: string;
  /** Pool contract type. If not provided, defaults to 'pool' (collect method). */
  readonly poolType?: PoolType;
}

export interface AddLiquidityTxParams {
  readonly poolId: string;
  readonly ownerAddress: string;
  readonly lowerTick: number;
  readonly upperTick: number;
  /** Liquidity units to add (as a string to preserve precision). */
  readonly liquidity: string;
  /** Pool contract type. If not provided, defaults to 'pool' (mint method). */
  readonly poolType?: PoolType;
}

export interface RerangeTxParams {
  readonly poolId: string;
  readonly positionId: string;
  readonly ownerAddress: string;
  /** Current liquidity in the position. */
  readonly liquidity: string;
  /** New lower tick for the position. */
  readonly newLowerTick: number;
  /** New upper tick for the position. */
  readonly newUpperTick: number;
  /** Pool contract type. If not provided, defaults to 'pool'. */
  readonly poolType?: PoolType;
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

/** Unsigned add-liquidity transaction envelope. */
export interface AddLiquidityUnsignedTx {
  /** Base-64 encoded XDR envelope. */
  readonly xdr: string;
  readonly type: 'add_liquidity';
}

/** Unsigned rerange (remove + add) transaction envelope. */
export interface RerangeUnsignedTx {
  /** Base-64 encoded XDR envelope. */
  readonly xdr: string;
  readonly type: 'rerange';
}

/** Discriminated union of all unsigned liquidity-management transaction types. */
export type UnsignedTx = BurnUnsignedTx | CollectUnsignedTx | AddLiquidityUnsignedTx | RerangeUnsignedTx;

/** Token amounts returned when removing liquidity. */
export interface RemoveAmountsResult {
  readonly amount0: string;
  readonly amount1: string;
}

/**
 * Builds an unsigned burn (remove liquidity) transaction XDR.
 *
 * Constructs a Soroban contract invocation that calls the remove_liquidity (cl_pool)
 * or burn (pool) function to remove liquidity from a position.
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

  const poolType = params.poolType ?? 'pool';
  const contract = new Contract(params.poolId);
  
  const totalLiquidity = BigInt(params.liquidity.split('.')[0]); // handle potential decimals just in case
  const liquidityToRemove = (totalLiquidity * BigInt(params.liquidityBps)) / 10000n;

  const ownerScVal = nativeToScVal(params.ownerAddress, { type: "address" });
  const positionIdScVal = nativeToScVal(params.positionId, { type: "u64" });
  const liquidityToRemoveScVal = nativeToScVal(liquidityToRemove.toString(), { type: "u128" });

  // cl_pool uses remove_liquidity(owner, position_id, liquidity), pool uses burn(position_id, tick_lower, tick_upper, amount)
  // For cl_pool, we call remove_liquidity with owner, position_id, and liquidity
  // For pool, we call burn with owner, position_id, and liquidity (tick range is tracked internally)
  const methodName = poolType === 'cl_pool' ? 'remove_liquidity' : 'burn';
  const burnOp = poolType === 'cl_pool'
    ? contract.call(methodName, ownerScVal, positionIdScVal, liquidityToRemoveScVal)
    : contract.call(methodName, positionIdScVal, nativeToScVal('0', { type: 'i32' }), nativeToScVal('0', { type: 'i32' }), liquidityToRemoveScVal);

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
 * @param params - Collect parameters including position ID, pool ID, and owner.
 * @returns An unsigned collect-fees transaction envelope in base-64 XDR format.
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

  const poolType = params.poolType ?? 'pool';
  const contract = new Contract(params.poolId);
  const ownerScVal = nativeToScVal(params.ownerAddress || params.ownerWallet, { type: "address" });
  const positionIdScVal = nativeToScVal(params.positionId, { type: "u64" });

  // pool contract: collect(position_id, tick_lower, tick_upper)
  // cl-pool contract: collect(owner, position_id)
  const collectOp = poolType === 'cl_pool'
    ? contract.call("collect", ownerScVal, positionIdScVal)
    : contract.call("collect", positionIdScVal, nativeToScVal('0', { type: 'i32' }), nativeToScVal('0', { type: 'i32' }));

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
 * Builds an unsigned add-liquidity transaction XDR.
 *
 * Constructs a Soroban contract invocation that calls the mint (pool) or
 * add_liquidity (cl_pool) function to add liquidity to a pool within a
 * specified tick range.
 *
 * @param params - Add liquidity parameters including pool ID, owner, tick range, and liquidity amount.
 * @returns An unsigned add-liquidity transaction envelope in base-64 XDR format.
 *
 * @throws {ValidationError} If parameters are invalid.
 */
export function buildAddLiquidityTx(params: AddLiquidityTxParams): AddLiquidityUnsignedTx {
  if (!params.poolId || !params.ownerAddress || !params.liquidity) {
    throw new ValidationError('Invalid add liquidity parameters: all fields are required');
  }

  if (params.lowerTick >= params.upperTick) {
    throw new ValidationError('lowerTick must be less than upperTick');
  }

  const liquidity = BigInt(params.liquidity);
  if (liquidity <= 0n) {
    throw new ValidationError('liquidity must be greater than zero');
  }

  const poolType = params.poolType ?? 'pool';
  const contract = new Contract(params.poolId);
  const ownerScVal = nativeToScVal(params.ownerAddress, { type: 'address' });
  const lowerTickScVal = nativeToScVal(params.lowerTick, { type: 'i32' });
  const upperTickScVal = nativeToScVal(params.upperTick, { type: 'i32' });
  const liquidityScVal = nativeToScVal(liquidity.toString(), { type: 'u128' });

  // pool contract: mint(position_id, tick_lower, tick_upper, amount)
  // cl-pool contract: add_liquidity(owner, tick_lower, tick_upper, liquidity)
  const mintOp = poolType === 'cl_pool'
    ? contract.call('add_liquidity', ownerScVal, lowerTickScVal, upperTickScVal, liquidityScVal)
    : contract.call('mint', nativeToScVal('0', { type: 'u64' }), lowerTickScVal, upperTickScVal, liquidityScVal);

  const sourceKeypair = Keypair.random();
  const sourceAccount = new Account(sourceKeypair.publicKey(), '0');

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: '100000',
    networkPassphrase: config.networkPassphrase,
  });

  txBuilder.addOperation(mintOp);
  const tx = txBuilder.setTimeout(30).build();
  const xdr = tx.toEnvelope().toXDR('base64');

  return { xdr, type: 'add_liquidity' };
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

/**
 * Builds an unsigned rerange transaction XDR.
 *
 * Constructs a Soroban contract invocation that atomically removes all liquidity
 * from the current tick range and re-adds it to a new tick range. This is a
 * convenience operation that combines burn + mint in a single transaction.
 *
 * @param params - Rerange parameters including position ID, pool ID, liquidity, and new tick range.
 * @returns An unsigned rerange transaction envelope in base-64 XDR format.
 *
 * @throws {ValidationError} If parameters are invalid.
 */
export function buildRerangeTx(params: RerangeTxParams): RerangeUnsignedTx {
  if (!params.poolId || !params.positionId || !params.ownerAddress || !params.liquidity) {
    throw new ValidationError('Invalid rerange parameters: all fields are required');
  }

  if (params.newLowerTick >= params.newUpperTick) {
    throw new ValidationError('newLowerTick must be less than newUpperTick');
  }

  const liquidity = BigInt(params.liquidity);
  if (liquidity <= 0n) {
    throw new ValidationError('liquidity must be greater than zero');
  }

  const poolType = params.poolType ?? 'pool';
  const contract = new Contract(params.poolId);
  const ownerScVal = nativeToScVal(params.ownerAddress, { type: 'address' });
  const positionIdScVal = nativeToScVal(params.positionId, { type: 'u64' });
  const liquidityScVal = nativeToScVal(liquidity.toString(), { type: 'u128' });
  const newLowerTickScVal = nativeToScVal(params.newLowerTick, { type: 'i32' });
  const newUpperTickScVal = nativeToScVal(params.newUpperTick, { type: 'i32' });

  // For cl_pool: remove_liquidity(owner, position_id, liquidity) + add_liquidity(owner, tick_lower, tick_upper, liquidity)
  // For pool: burn(position_id, tick_lower, tick_upper, amount) + mint(position_id, tick_lower, tick_upper, amount)
  // We build a transaction with two operations: remove then add
  let removeOp, addOp;

  if (poolType === 'cl_pool') {
    removeOp = contract.call('remove_liquidity', ownerScVal, positionIdScVal, liquidityScVal);
    addOp = contract.call('add_liquidity', ownerScVal, newLowerTickScVal, newUpperTickScVal, liquidityScVal);
  } else {
    // For pool contract, we need the old tick range to remove. Use placeholder values.
    // In practice, the caller should pass the old tick range or detect it from the position.
    removeOp = contract.call('burn', positionIdScVal, nativeToScVal('0', { type: 'i32' }), nativeToScVal('0', { type: 'i32' }), liquidityScVal);
    addOp = contract.call('mint', positionIdScVal, newLowerTickScVal, newUpperTickScVal, liquidityScVal);
  }

  const sourceKeypair = Keypair.random();
  const sourceAccount = new Account(sourceKeypair.publicKey(), '0');

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: '200000', // Higher fee for multi-op transaction
    networkPassphrase: config.networkPassphrase,
  });

  txBuilder.addOperation(removeOp);
  txBuilder.addOperation(addOp);
  const tx = txBuilder.setTimeout(30).build();
  const xdr = tx.toEnvelope().toXDR('base64');

  return { xdr, type: 'rerange' };
}
