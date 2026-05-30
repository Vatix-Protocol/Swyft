import { SorobanRpc, Contract, xdr, scValToNative } from '@stellar/stellar-sdk';
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
  args: xdr.ScVal[] = [],
): Promise<xdr.ScVal> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const contract = new Contract(contractAddress);
  const op = contract.call(method, ...args);

  try {
    const result = await server.simulateTransaction(
      // We only need the result value; build a minimal transaction envelope
      // by wrapping the operation in a simulation request directly.
      // stellar-sdk's simulateTransaction accepts an Operation or a built tx;
      // here we pass the raw operation xdr for simulation.
      op as unknown as Parameters<typeof server.simulateTransaction>[0],
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
    throw new SwyftRpcError(
      `RPC call failed for ${method} on ${contractAddress}: ${(err as Error).message}`,
      err,
    );
  }
}

export async function getPool({
  rpcUrl,
  poolAddress,
}: {
  rpcUrl: string;
  poolAddress: string;
}): Promise<PoolState> {
  const retval = await callContract(rpcUrl, poolAddress, 'get_pool_state');
  const raw = scValToNative(retval) as Record<string, unknown>;

  // Return empty pool state if data is null, undefined, or not an object
  if (!raw || typeof raw !== 'object') {
    return {
      poolAddress,
      sqrtPrice: '0',
      currentTick: 0,
      liquidity: '0',
      feeTier: 0,
      token0: '',
      token1: '',
    };
  }

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
  const raw = scValToNative(retval) as Record<string, unknown>;

  // Return empty position state if data is null, undefined, or not an object
  if (!raw || typeof raw !== 'object') {
    return {
      positionNftId,
      owner: '',
      pool: '',
      lowerTick: 0,
      upperTick: 0,
      liquidity: '0',
    };
  }

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
  const raw = scValToNative(retval) as Record<string, unknown>;

  // Return empty tick state if data is null, undefined, or not an object
  if (!raw || typeof raw !== 'object') {
    return {
      tick,
      liquidityNet: '0',
      liquidityGross: '0',
      feeGrowthOutside: '0',
    };
  }

  return {
    tick,
    liquidityNet: String(raw['liquidity_net'] ?? raw['liquidityNet'] ?? '0'),
    liquidityGross: String(raw['liquidity_gross'] ?? raw['liquidityGross'] ?? '0'),
    feeGrowthOutside: String(raw['fee_growth_outside'] ?? raw['feeGrowthOutside'] ?? '0'),
  };
}
