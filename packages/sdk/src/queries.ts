import {
  rpc,
  Contract,
  xdr,
  scValToNative,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import { PoolState, PositionState, TickState, SwyftRpcError } from './types';

/**
 * Explanatory copy for empty position state.
 * Used by the UI layer when no positions are found.
 */
export const EMPTY_POSITION_MESSAGE = 'No positions found. Make a deposit to get started.';

async function callContract(
  rpcUrl: string,
  contractAddress: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<xdr.ScVal> {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const contract = new Contract(contractAddress);
  const op = contract.call(method, ...args);

  try {
    // stellar-sdk's simulateTransaction requires a built Transaction or FeeBumpTransaction.
    // The Operation returned by contract.call() is cast here because the stub simulation
    // path only needs the operation XDR; replace with a fully-built transaction once
    // the Soroban signing flow is wired up.
    const result = await server.simulateTransaction(
      op as unknown as Transaction | FeeBumpTransaction
    );

    if (rpc.Api.isSimulationError(result)) {
      throw new SwyftRpcError(`Simulation failed for ${method}: ${result.error}`);
    }

    const sim = result as rpc.Api.SimulateTransactionSuccessResponse;
    if (!sim.result) {
      throw new SwyftRpcError(`No result returned for ${method} on ${contractAddress}`);
    }
    return sim.result.retval;
  } catch (err) {
    if (err instanceof SwyftRpcError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SwyftRpcError(`RPC call failed for ${method} on ${contractAddress}: ${message}`, err);
  }
}

/**
 * Validates that a raw scValToNative result is a plain object.
 * Throws SwyftRpcError if the value has an unexpected shape.
 *
 * @param raw - The raw value to validate
 * @param context - Description of where the value came from (for error messages)
 * @returns The validated object with safely indexed string keys
 * @throws {SwyftRpcError} If raw is null, not an object, or an array
 */
function assertRawObject(raw: unknown, context: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SwyftRpcError(`Unexpected response shape from ${context}`);
  }
  return raw as Record<string, unknown>;
}

/**
 * Safely extracts a string value from an object with fallback.
 * Returns the first non-null/undefined value from the list of keys.
 *
 * @param obj - The object to extract from
 * @param keys - List of key names to check in order
 * @param fallback - Default value if all keys are null/undefined
 * @returns The extracted string or fallback value
 */
function extractString(
  obj: Record<string, unknown>,
  keys: readonly string[],
  fallback: string
): string {
  for (const key of keys) {
    const value = obj[key];
    if (value != null) {
      return String(value);
    }
  }
  return fallback;
}

/**
 * Safely extracts a number value from an object with fallback.
 * Returns the first non-null/undefined value from the list of keys.
 *
 * @param obj - The object to extract from
 * @param keys - List of key names to check in order
 * @param fallback - Default value if all keys are null/undefined
 * @returns The extracted number or fallback value
 */
function extractNumber(
  obj: Record<string, unknown>,
  keys: readonly string[],
  fallback: number
): number {
  for (const key of keys) {
    const value = obj[key];
    if (value != null) {
      return Number(value);
    }
  }
  return fallback;
}

/**
 * Fetches the current state of a liquidity pool.
 *
 * @param options - Configuration object
 * @param options.rpcUrl - Soroban RPC URL
 * @param options.poolAddress - Contract address of the pool
 * @returns Promise resolving to the pool's current state
 * @throws {SwyftRpcError} If the RPC call fails or returns an unexpected shape
 */
export async function getPool({
  rpcUrl,
  poolAddress,
}: {
  rpcUrl: string;
  poolAddress: string;
}): Promise<PoolState> {
  const retval = await callContract(rpcUrl, poolAddress, 'get_pool_state');
  const raw = assertRawObject(scValToNative(retval), poolAddress);

  return {
    poolAddress,
    sqrtPrice: extractString(raw, ['sqrt_price', 'sqrtPrice'], '0'),
    currentTick: extractNumber(raw, ['current_tick', 'currentTick'], 0),
    liquidity: extractString(raw, ['liquidity'], '0'),
    feeTier: extractNumber(raw, ['fee_tier', 'feeTier'], 0),
    token0: extractString(raw, ['token0'], ''),
    token1: extractString(raw, ['token1'], ''),
  };
}

/**
 * Fetches the state of a concentrated liquidity position (NFT).
 * Returns null if the position does not exist or is empty.
 *
 * @param options - Configuration object
 * @param options.rpcUrl - Soroban RPC URL
 * @param options.positionNftId - NFT contract address that holds the position
 * @returns Promise resolving to the position state, or null if not found
 * @throws {SwyftRpcError} If the RPC call fails
 */
export async function getPosition({
  rpcUrl,
  positionNftId,
}: {
  rpcUrl: string;
  positionNftId: string;
}): Promise<PositionState | null> {
  // positionNftId is the NFT contract address that holds the position
  const retval = await callContract(rpcUrl, positionNftId, 'get_position');
  if (retval.switch().name === 'scvVoid') return null;

  const rawValue = scValToNative(retval);
  if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }

  const raw = rawValue as Record<string, unknown>;
  if (Object.keys(raw).length === 0) {
    return null;
  }

  const maybeValue = raw['value'];
  if ('value' in raw && maybeValue == null) {
    return null;
  }

  const positionData = 'value' in raw && maybeValue !== undefined ? maybeValue : raw;
  if (positionData === null || typeof positionData !== 'object' || Array.isArray(positionData)) {
    return null;
  }

  const position = positionData as Record<string, unknown>;
  return {
    positionNftId,
    owner: extractString(position, ['owner'], ''),
    pool: extractString(position, ['pool'], ''),
    lowerTick: extractNumber(position, ['lower_tick', 'lowerTick'], 0),
    upperTick: extractNumber(position, ['upper_tick', 'upperTick'], 0),
    liquidity: extractString(position, ['liquidity'], '0'),
  };
}

/**
 * Async position query helper that yields a microtask before resolving.
 * This is useful for UI consumers that want to show a loading state while the
 * query is in-flight.
 *
 * @param options - Configuration object
 * @param options.rpcUrl - Soroban RPC URL
 * @param options.positionNftId - NFT contract address that holds the position
 * @returns Promise resolving to the position state, or null if not found
 * @throws {SwyftRpcError} If the RPC call fails
 */
export async function getPositionWithLoading({
  rpcUrl,
  positionNftId,
}: {
  rpcUrl: string;
  positionNftId: string;
}): Promise<PositionState | null> {
  await Promise.resolve();
  return getPosition({ rpcUrl, positionNftId });
}

/**
 * Fetches the state of a specific tick in a liquidity pool.
 *
 * @param options - Configuration object
 * @param options.rpcUrl - Soroban RPC URL
 * @param options.poolAddress - Contract address of the pool
 * @param options.tick - Tick index to query
 * @returns Promise resolving to the tick's current state
 * @throws {SwyftRpcError} If the RPC call fails or returns an unexpected shape
 */
export async function getTick({
  rpcUrl,
  poolAddress,
  tick,
}: {
  rpcUrl: string;
  poolAddress: string;
  tick: number;
}): Promise<TickState> {
  const tickArg = xdr.ScVal.scvI32(tick);
  const retval = await callContract(rpcUrl, poolAddress, 'get_tick', [tickArg]);
  const raw = assertRawObject(scValToNative(retval), `tick ${tick} on ${poolAddress}`);

  return {
    tick,
    liquidityNet: extractString(raw, ['liquidity_net', 'liquidityNet'], '0'),
    liquidityGross: extractString(raw, ['liquidity_gross', 'liquidityGross'], '0'),
    feeGrowthOutside: extractString(raw, ['fee_growth_outside', 'feeGrowthOutside'], '0'),
  };
}
