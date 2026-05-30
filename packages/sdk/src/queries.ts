import { SorobanRpc, Contract, xdr, scValToNative, Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { PoolState, PositionState, TickState, SwyftRpcError } from './types';

/**
 * Explanatory copy for empty position state.
 * Used by the UI layer when no positions are found.
 */
export const EMPTY_POSITION_MESSAGE =
  'No positions found. Make a deposit to get started.';

async function callContract(
  rpcUrl: string,
  contractAddress: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<xdr.ScVal> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const contract = new Contract(contractAddress);
  const op = contract.call(method, ...args);

  try {
    // stellar-sdk's simulateTransaction requires a built Transaction or FeeBumpTransaction.
    // The Operation returned by contract.call() is cast here because the stub simulation
    // path only needs the operation XDR; replace with a fully-built transaction once
    // the Soroban signing flow is wired up.
    const result = await server.simulateTransaction(
      op as unknown as Transaction | FeeBumpTransaction,
    );

    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new SwyftRpcError(`Simulation failed for ${method}: ${result.error}`);
    }

    const sim = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!sim.result) {
      throw new SwyftRpcError(`No result returned for ${method} on ${contractAddress}`);
    }
    return sim.result.retval;
  } catch (err) {
    if (err instanceof SwyftRpcError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SwyftRpcError(
      `RPC call failed for ${method} on ${contractAddress}: ${message}`,
      err,
    );
  }
}

/** Asserts that a raw scValToNative result is a plain object, throwing on unexpected shapes. */
function assertRawObject(raw: unknown, context: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SwyftRpcError(`Unexpected response shape from ${context}`);
  }
  return raw as Record<string, unknown>;
}

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
    sqrtPrice: String(raw['sqrt_price'] ?? raw['sqrtPrice'] ?? '0'),
    currentTick: Number(raw['current_tick'] ?? raw['currentTick'] ?? 0),
    liquidity: String(raw['liquidity'] ?? '0'),
    feeTier: Number(raw['fee_tier'] ?? raw['feeTier'] ?? 0),
    token0: String(raw['token0'] ?? ''),
    token1: String(raw['token1'] ?? ''),
  };
}

export async function getPosition({
  rpcUrl,
  positionNftId,
}: {
  rpcUrl: string;
  positionNftId: string;
}): Promise<PositionState> {
  // positionNftId is the NFT contract address that holds the position
  const retval = await callContract(rpcUrl, positionNftId, 'get_position');
  const raw = assertRawObject(scValToNative(retval), positionNftId);

  // Contract may return void/null when the position does not exist
  if (retval.switch().name === 'scvVoid') return null;

  const raw = scValToNative(retval) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return null;

  // If the decoder yields an empty object, treat it as Option::None.
  if (Object.keys(raw as Record<string, unknown>).length === 0) {
    throw new SwyftRpcError(`Position is empty (token not found) on ${positionNftId}`);
  }

  // Handle potential option-like wrappers: { value: null }
  const maybeValue = (raw as Record<string, unknown>)['value'];
  if ('value' in (raw as Record<string, unknown>) && maybeValue == null) {
    throw new SwyftRpcError(`Position is empty (token not found) on ${positionNftId}`);
  }

  // If wrapped as { value: PositionMetadata }, unwrap it.
  const position =
    'value' in (raw as Record<string, unknown>)
      ? ((raw as Record<string, unknown>)['value'] ?? raw)
      : raw;

  return {
    positionNftId,
    owner: String((position as Record<string, unknown>)['owner'] ?? ''),
    pool: String((position as Record<string, unknown>)['pool'] ?? ''),
    lowerTick: Number(
      (position as Record<string, unknown>)['lower_tick'] ??
        (position as Record<string, unknown>)['lowerTick'] ??
        0
    ),
    upperTick: Number(
      (position as Record<string, unknown>)['upper_tick'] ??
        (position as Record<string, unknown>)['upperTick'] ??
        0
    ),
    liquidity: String((position as Record<string, unknown>)['liquidity'] ?? '0'),
  };
}

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
    liquidityNet: String(raw['liquidity_net'] ?? raw['liquidityNet'] ?? '0'),
    liquidityGross: String(raw['liquidity_gross'] ?? raw['liquidityGross'] ?? '0'),
    feeGrowthOutside: String(raw['fee_growth_outside'] ?? raw['feeGrowthOutside'] ?? '0'),
  };
}
