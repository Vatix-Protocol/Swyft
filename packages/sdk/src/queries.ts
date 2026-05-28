import { SorobanRpc, Contract, xdr, scValToNative, Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { PoolState, PositionState, TickState, SwyftRpcError } from './types';

async function callContract(
  rpcUrl: string,
  contractAddress: string,
  method: string,
  args: xdr.ScVal[] = [],
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

  return {
    positionNftId,
    owner: String(raw['owner'] ?? ''),
    pool: String(raw['pool'] ?? ''),
    lowerTick: Number(raw['lower_tick'] ?? raw['lowerTick'] ?? 0),
    upperTick: Number(raw['upper_tick'] ?? raw['upperTick'] ?? 0),
    liquidity: String(raw['liquidity'] ?? '0'),
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
