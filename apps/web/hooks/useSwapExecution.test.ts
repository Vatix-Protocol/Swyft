import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SwapQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { MevSubmissionError } from '@/lib/mev-submission';
import { WalletRejectionError } from '@/lib/wallet-errors';

const signTransaction = vi.fn();
const submitTransaction = vi.fn();

vi.mock('@swyft/sdk', () => ({
  buildSwapTx: () => ({ xdr: 'UNSIGNED_XDR' }),
  buildExactOutputSwapTx: () => ({ xdr: 'UNSIGNED_XDR' }),
  toRawAmount: (v: string) => BigInt(v),
  toStellarAddress: (v: string) => v,
}));
vi.mock('@/context/WalletContext', () => ({ useWalletContext: () => ({ signTransaction }) }));
vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ network: 'TESTNET', apiBase: 'http://api.test' }),
}));
vi.mock('@/context/TransactionStatusContext', () => ({
  useTransactionStatus: () => ({ reportTx: vi.fn() }),
}));
vi.mock('./useMevProtection', () => ({
  useMevProtection: () => ({ enabled: false, mevRpcUrl: '' }),
}));
vi.mock('@/lib/mev-submission', async (orig) => ({
  ...(await orig<typeof import('@/lib/mev-submission')>()),
  submitTransaction: (...args: unknown[]) => submitTransaction(...args),
}));

import { useSwapExecution } from './useSwapExecution';

const token = (id: string): Token => ({ id, symbol: id, name: id, decimals: 7 }) as Token;
const params = {
  poolId: 'POOL',
  tokenIn: token('XLM'),
  tokenOut: token('USDC'),
  amountIn: '10',
  quote: { minimumReceived: '9' } as SwapQuote,
  walletAddress: 'GWALLET',
};

async function run() {
  const { result } = renderHook(() => useSwapExecution());
  await act(() => result.current.execute(params));
  return result.current;
}

describe('useSwapExecution', () => {
  beforeEach(() => {
    signTransaction.mockReset();
    submitTransaction.mockReset();
  });

  it('signs and submits, ending in success with the tx hash', async () => {
    signTransaction.mockResolvedValue('SIGNED_XDR');
    submitTransaction.mockResolvedValue({ hash: 'abc123' });

    const state = await run();

    expect(signTransaction).toHaveBeenCalledWith('UNSIGNED_XDR');
    expect(submitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ signedXdr: 'SIGNED_XDR', apiBase: 'http://api.test' })
    );
    expect(state.status).toBe('success');
    expect(state.txHash).toBe('abc123');
    expect(state.error).toBeNull();
  });

  it('reports a wallet rejection without submitting', async () => {
    signTransaction.mockRejectedValue(new WalletRejectionError());

    const state = await run();

    expect(submitTransaction).not.toHaveBeenCalled();
    expect(state.status).toBe('error');
    expect(state.error).toBe('rejected');
  });

  it('maps a slippage submission failure to a slippage error', async () => {
    signTransaction.mockResolvedValue('SIGNED_XDR');
    submitTransaction.mockRejectedValue(
      new MevSubmissionError('Slippage exceeded', 'SLIPPAGE_EXCEEDED')
    );

    const state = await run();

    expect(state.status).toBe('error');
    expect(state.error).toBe('slippage');
    expect(state.txHash).toBeNull();
  });
});
