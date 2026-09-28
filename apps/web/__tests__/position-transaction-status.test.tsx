import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';
import { useRemoveLiquidity } from '@/hooks/useRemoveLiquidity';
import { useRerangeLiquidity } from '@/hooks/useRerangeLiquidity';

const { reportTx } = vi.hoisted(() => ({ reportTx: vi.fn() }));

vi.mock('@swyft/sdk', () => ({
  buildBurnTx: () => ({ xdr: 'burn-xdr' }),
  buildCollectTx: () => ({ xdr: 'collect-xdr' }),
  buildRerangeTx: () => ({ xdr: 'rerange-xdr' }),
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({
    apiBase: 'https://test-api.example/v1',
    network: 'TESTNET',
  }),
}));

vi.mock('@/context/TransactionStatusContext', () => ({
  useTransactionStatus: () => ({ reportTx }),
}));

const position: PositionSnapshot = {
  id: 'position-1',
  ownerWallet: 'GOWNER',
  poolId: 'pool-1',
  token0: 'USDC',
  token1: 'XLM',
  lowerTick: -100,
  upperTick: 100,
  liquidity: '1000',
  currentValueUsd: 25,
  uncollectedFeesToken0: '0.1',
  uncollectedFeesToken1: '0.2',
  createdAt: 1_700_000_000,
  closedAt: null,
  status: 'active',
  poolCurrentPrice: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: 'confirmed-hash', successful: true }),
    }),
  );
});

describe('position transaction status', () => {
  it('reports remove-liquidity success only after an on-ledger success response', async () => {
    const { result } = renderHook(() =>
      useRemoveLiquidity(position, 'wallet-token', async () => 'signed-xdr'),
    );

    await act(async () => {
      await result.current.removeLiquidity(100);
    });

    expect(result.current.status).toBe('success');
    expect(result.current.txHash).toBe('confirmed-hash');
    expect(fetch).toHaveBeenCalledWith(
      'https://test-api.example/v1/transactions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer wallet-token' }),
      }),
    );
    expect(reportTx).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Remove liquidity', status: 'success' }),
    );
  });

  it('reports a ledger failure instead of treating HTTP success as transaction success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: 'failed-hash', successful: false }),
      }),
    );
    const { result } = renderHook(() =>
      useRemoveLiquidity(position, 'wallet-token', async () => 'signed-xdr'),
    );

    await act(async () => {
      await result.current.removeLiquidity(100);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.txError).toBe('failed');
    expect(reportTx).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Remove liquidity', status: 'error' }),
    );
  });

  it('reports rerange confirmation with the selected network', async () => {
    const { result } = renderHook(() =>
      useRerangeLiquidity(position, 'wallet-token', async () => 'signed-xdr'),
    );

    await act(async () => {
      await result.current.rerange(-200, 200);
    });

    expect(result.current.status).toBe('success');
    expect(reportTx).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Rerange liquidity',
        status: 'success',
        network: 'TESTNET',
        txHash: 'confirmed-hash',
      }),
    );
  });
});
