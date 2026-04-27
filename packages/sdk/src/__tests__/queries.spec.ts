import { getPool, getPosition, getTick } from '../queries';
import { SwyftRpcError } from '../types';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn(),
      Api: actual.SorobanRpc.Api,
    },
    Contract: jest.fn(),
  };
});

const mockSimulate = jest.fn();
const mockCall = jest.fn().mockReturnValue({});

beforeEach(() => {
  jest.clearAllMocks();
  (SorobanRpc.Server as unknown as jest.Mock).mockImplementation(() => ({
    simulateTransaction: mockSimulate,
  }));
  const { Contract } = jest.requireMock('@stellar/stellar-sdk') as { Contract: jest.Mock };
  Contract.mockImplementation(() => ({ call: mockCall }));
});

function makeSuccessResult(nativeValue: unknown) {
  const retval = xdr.ScVal.scvVoid(); // placeholder; scValToNative is also mocked below
  return { result: { retval }, error: undefined };
}

// Mock scValToNative to return our test data
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
  return {
    ...actual,
    scValToNative: jest.fn(),
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn(),
      Api: { isSimulationError: jest.fn().mockReturnValue(false) },
    },
    Contract: jest.fn(),
  };
});

import { scValToNative } from '@stellar/stellar-sdk';
const mockScValToNative = scValToNative as jest.Mock;

describe('getPool', () => {
  it('returns typed PoolState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} }, error: undefined });
    mockScValToNative.mockReturnValue({
      sqrt_price: '12345',
      current_tick: -100,
      liquidity: '9999',
      fee_tier: 3000,
      token0: 'CABC',
      token1: 'CDEF',
    });

    const pool = await getPool({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL' });

    expect(pool).toEqual({
      poolAddress: 'CPOOL',
      sqrtPrice: '12345',
      currentTick: -100,
      liquidity: '9999',
      feeTier: 3000,
      token0: 'CABC',
      token1: 'CDEF',
    });
  });

  it('throws SwyftRpcError on simulation error', async () => {
    const { SorobanRpc: MockRpc } = jest.requireMock('@stellar/stellar-sdk') as {
      SorobanRpc: { Api: { isSimulationError: jest.Mock }; Server: jest.Mock };
    };
    MockRpc.Api.isSimulationError.mockReturnValueOnce(true);
    mockSimulate.mockResolvedValue({ error: 'contract trap' });

    await expect(getPool({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL' })).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError on network failure', async () => {
    mockSimulate.mockRejectedValue(new Error('network timeout'));
    await expect(getPool({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL' })).rejects.toBeInstanceOf(SwyftRpcError);
  });
});

describe('getPosition', () => {
  it('returns typed PositionState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    mockScValToNative.mockReturnValue({
      owner: 'GOWNER',
      pool: 'CPOOL',
      lower_tick: -200,
      upper_tick: 200,
      liquidity: '5000',
    });

    const pos = await getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' });

    expect(pos).toEqual({
      positionNftId: 'CNFT',
      owner: 'GOWNER',
      pool: 'CPOOL',
      lowerTick: -200,
      upperTick: 200,
      liquidity: '5000',
    });
  });
});

describe('getTick', () => {
  it('returns typed TickState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    mockScValToNative.mockReturnValue({
      liquidity_net: '100',
      liquidity_gross: '200',
      fee_growth_outside: '50',
    });

    const tick = await getTick({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL', tick: 60 });

    expect(tick).toEqual({
      tick: 60,
      liquidityNet: '100',
      liquidityGross: '200',
      feeGrowthOutside: '50',
    });
  });
});
