import { getPool, getPosition, getTick } from '../queries';
import { SwyftRpcError } from '../types';
import { SorobanRpc, xdr, scValToNative } from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  // Keep the shape minimal and aligned with packages/sdk/src/queries.ts imports.
  // @stellar/stellar-sdk v13+ exports Soroban (not SorobanRpc) at the type level,
  // so the previous test mock that references `actual.SorobanRpc` crashes.
  return {
    SorobanRpc: {
      Server: jest.fn(),
      Api: {
        isSimulationError: jest.fn().mockReturnValue(false),
      },
    },
    Contract: jest.fn(),
    scValToNative: jest.fn(),
    xdr: {
      ScVal: {
        scvI32: jest.fn(),
      },
    },
  };
});

const mockSimulate = jest.fn();
const mockCall = jest.fn().mockReturnValue({});

beforeEach(() => {
  jest.clearAllMocks();

  (SorobanRpc.Server as unknown as jest.Mock).mockImplementation(() => ({
    simulateTransaction: mockSimulate,
  }));

  const { Contract } = jest.requireMock('@stellar/stellar-sdk') as {
    Contract: jest.Mock;
  };
  Contract.mockImplementation(() => ({ call: mockCall }));
});

describe('getPool', () => {
  it('returns typed PoolState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} }, error: undefined });
    (scValToNative as unknown as jest.Mock).mockReturnValue({
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
    (SorobanRpc.Api.isSimulationError as jest.Mock).mockReturnValueOnce(true);
    mockSimulate.mockResolvedValue({ error: 'contract trap' });

    await expect(
      getPool({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError on network failure', async () => {
    mockSimulate.mockRejectedValue(new Error('network timeout'));
    await expect(
      getPool({ rpcUrl: 'https://rpc.example.com', poolAddress: 'CPOOL' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });
});

describe('getPosition', () => {
  it('returns typed PositionState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    (scValToNative as unknown as jest.Mock).mockReturnValue({
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

  it('throws SwyftRpcError when position is empty (Option::None)', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    (scValToNative as unknown as jest.Mock).mockReturnValue(null);

    await expect(
      getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError when position is empty (decoder returns empty object)', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    (scValToNative as unknown as jest.Mock).mockReturnValue({});

    await expect(
      getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError when position is empty (wrapped option-like { value: null })', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    (scValToNative as unknown as jest.Mock).mockReturnValue({ value: null });

    await expect(
      getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError on simulation error', async () => {
    (SorobanRpc.Api.isSimulationError as jest.Mock).mockReturnValueOnce(true);
    mockSimulate.mockResolvedValue({ error: 'contract trap' });

    await expect(
      getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });

  it('throws SwyftRpcError on network failure', async () => {
    mockSimulate.mockRejectedValue(new Error('network timeout'));

    await expect(
      getPosition({ rpcUrl: 'https://rpc.example.com', positionNftId: 'CNFT' })
    ).rejects.toBeInstanceOf(SwyftRpcError);
  });
});

describe('getTick', () => {
  it('returns typed TickState on success', async () => {
    mockSimulate.mockResolvedValue({ result: { retval: {} } });
    (scValToNative as unknown as jest.Mock).mockReturnValue({
      liquidity_net: '100',
      liquidity_gross: '200',
      fee_growth_outside: '50',
    });

    const tick = await getTick({
      rpcUrl: 'https://rpc.example.com',
      poolAddress: 'CPOOL',
      tick: 60,
    });

    expect(tick).toEqual({
      tick: 60,
      liquidityNet: '100',
      liquidityGross: '200',
      feeGrowthOutside: '50',
    });
  });
});
