/**
 * Regression tests for the add-liquidity submission flow (issue #818).
 *
 * `useAddLiquidity().submit` used to:
 *   1. build a base64 JSON blob instead of real Soroban transaction XDR,
 *   2. `setTimeout` for 1.2s to simulate network latency, and
 *   3. resolve with a fabricated `0x${random}` tx hash plus a synthetic
 *      `pos-<timestamp>` position NFT id — none of it ever touched a wallet
 *      or the chain.
 *
 * These tests assert the hook now goes through the real pipeline used by
 * every other transaction hook in this app (see `useRemoveLiquidity.ts`,
 * `useSwapExecution.ts`): build XDR via `@swyft/sdk`, sign via the Freighter
 * integration, submit to the real `/transactions` API, and only ever report
 * data that actually came back from that pipeline.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAddLiquidity } from '@/hooks/useAddLiquidity';
import type { PoolDetail } from '@/hooks/usePoolTicks';

const mockSignTransaction = vi.fn();
vi.mock('@stellar/freighter-api', () => ({
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

const mockBuildAddLiquidityTx = vi.fn();
vi.mock('@swyft/sdk', async () => {
  const actual = await vi.importActual<typeof import('@swyft/sdk')>('@swyft/sdk');
  return {
    ...actual,
    buildAddLiquidityTx: (...args: unknown[]) => mockBuildAddLiquidityTx(...args),
  };
});

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ network: 'TESTNET' }),
}));

vi.mock('@/lib/constants', () => ({
  API_BASE: 'http://localhost:3001/v1',
  getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
}));

const mockPool: PoolDetail = {
  id: 'pool-1',
  token0: 'TOKEN0',
  token1: 'TOKEN1',
  token0Symbol: 'XLM',
  token1Symbol: 'USDC',
  feeTier: '0.30%',
  currentPrice: 1.0,
  currentTick: 0,
  tvl: 1_000_000,
  feeApr: 10,
  volume24h: 500_000,
};

/** Unused by the hook today, but part of `submit`'s public signature. */
const noopSignXdr = async (xdr: string) => xdr;

function mockOkFetch(hash: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ hash }),
  }) as unknown as typeof fetch;
}

async function setUpAndSubmit(result: { current: ReturnType<typeof useAddLiquidity> }) {
  act(() => result.current.setPool(mockPool));
  act(() => result.current.setAmount0('100'));
  await act(async () => {
    await result.current.submit('GOWNERADDRESSGOWNERADDRESSGOWNERADDRESSGOWNERADD', noopSignXdr);
  });
}

describe('useAddLiquidity — submit (real XDR build, sign, and submission)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockBuildAddLiquidityTx.mockReturnValue({ xdr: 'unsigned-add-liquidity-xdr', type: 'add_liquidity' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds XDR via the real SDK builder, signs via Freighter, and posts to the real /transactions endpoint', async () => {
    mockSignTransaction.mockResolvedValue('signed-add-liquidity-xdr');
    mockOkFetch('f00dreal-tx-hash-from-horizon');

    const { result } = renderHook(() => useAddLiquidity());
    await setUpAndSubmit(result);

    await waitFor(() => expect(result.current.txStatus).toBe('success'));

    // Real SDK call — not a hand-built base64 JSON blob.
    expect(mockBuildAddLiquidityTx).toHaveBeenCalledWith(
      expect.objectContaining({ poolId: mockPool.id, ownerAddress: expect.stringMatching(/^G/) })
    );
    // Real Freighter signing of the XDR the SDK produced.
    expect(mockSignTransaction).toHaveBeenCalledWith(
      'unsigned-add-liquidity-xdr',
      expect.objectContaining({ networkPassphrase: expect.any(String) })
    );
    // Real submission to the shared transactions API used by every other
    // transaction hook (swap, remove-liquidity, reranging).
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/v1/transactions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ xdr: 'signed-add-liquidity-xdr' }),
      })
    );
  });

  it('reports exactly the hash returned by the API — never a fabricated 0x-random hash', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockOkFetch('f00dreal-tx-hash-from-horizon');

    const { result } = renderHook(() => useAddLiquidity());
    await setUpAndSubmit(result);

    await waitFor(() => expect(result.current.txStatus).toBe('success'));

    expect(result.current.txHash).toBe('f00dreal-tx-hash-from-horizon');
    // The old bug produced a hash matching /^0x[0-9a-f]+$/ from Math.random().
    expect(result.current.txHash).not.toMatch(/^0x[0-9a-f]+$/i);
  });

  it('never fabricates a synthetic position NFT id when the API does not provide one', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockOkFetch('real-hash-2');

    const { result } = renderHook(() => useAddLiquidity());
    await setUpAndSubmit(result);

    await waitFor(() => expect(result.current.txStatus).toBe('success'));

    // The old bug set this to `pos-${Date.now().toString(36)}`.
    expect(result.current.positionNftId).not.toMatch(/^pos-[0-9a-z]+$/);
    expect(result.current.positionNftId).toBeNull();
  });

  it('does not resolve to a fake success when the API submission fails', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAddLiquidity());
    await setUpAndSubmit(result);

    await waitFor(() => expect(result.current.txStatus).toBe('error'));

    expect(result.current.txHash).toBeNull();
    expect(result.current.positionNftId).toBeNull();
  });

  it('does not resolve to a fake success when the wallet rejects signing', async () => {
    mockSignTransaction.mockResolvedValue({ signedTxXdr: null } as unknown as string);

    const { result } = renderHook(() => useAddLiquidity());
    await setUpAndSubmit(result);

    await waitFor(() => expect(result.current.txStatus).toBe('error'));

    expect(result.current.txError).toBe('rejected');
    expect(result.current.txHash).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
