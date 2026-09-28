import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TransactionStatusProvider,
  useTransactionStatus,
} from './TransactionStatusContext';

function PendingTransaction({ hash }: { hash: string }) {
  const { pendingTx, reportTx } = useTransactionStatus();

  useEffect(() => {
    reportTx({
      label: 'Swap',
      status: 'pending',
      txHash: hash,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      network: 'TESTNET',
    });
  }, [hash, reportTx]);

  return <span>{pendingTx?.status ?? 'idle'}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('TransactionStatusProvider ledger confirmation', () => {
  it('keeps an accepted transaction pending until the RPC confirms it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { status: 'SUCCESS' } }),
      }),
    );

    render(
      <TransactionStatusProvider>
        <PendingTransaction hash="confirmed-hash" />
      </TransactionStatusProvider>,
    );

    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument());
    expect(sessionStorage.getItem('swyft_pending_tx')).toContain('confirmed-hash');
  });

  it('surfaces an on-ledger failure as failed, not confirmed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: { status: 'FAILED', errorResultXdr: 'failure-xdr' },
        }),
      }),
    );

    render(
      <TransactionStatusProvider>
        <PendingTransaction hash="failed-hash" />
      </TransactionStatusProvider>,
    );

    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument());
    expect(sessionStorage.getItem('swyft_pending_tx')).toContain('Transaction failed on-ledger');
  });
});
