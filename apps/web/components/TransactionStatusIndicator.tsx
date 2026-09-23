'use client';

import { useEffect } from 'react';
import { useTransactionStatus } from '@/context/TransactionStatusContext';
import { useNetworkContext } from '@/context/NetworkContext';
import { getExplorerTxUrl } from '@/lib/constants';

/** Success/error toasts clear themselves after this long if left untouched. */
const AUTO_DISMISS_MS = 12000;

export function TransactionStatusIndicator() {
  const { pendingTx, dismiss } = useTransactionStatus();
  const { network } = useNetworkContext();

  useEffect(() => {
    if (!pendingTx || (pendingTx.status !== 'success' && pendingTx.status !== 'error')) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTx?.status, pendingTx?.txHash]);

  if (!pendingTx) return null;

  const isBusy = pendingTx.status === 'signing' || pendingTx.status === 'submitting';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 min-h-[36px]"
    >
      {isBusy && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
          aria-hidden="true"
        />
      )}
      {pendingTx.status === 'success' && (
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
      )}
      {pendingTx.status === 'error' && (
        <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
      )}

      <span className="max-w-[9rem] truncate sm:max-w-none">
        {pendingTx.status === 'signing' && 'Waiting for signature…'}
        {pendingTx.status === 'submitting' && `Submitting ${pendingTx.label}…`}
        {pendingTx.status === 'success' && `${pendingTx.label} confirmed`}
        {pendingTx.status === 'error' && (pendingTx.errorMessage ?? `${pendingTx.label} failed`)}
      </span>

      {pendingTx.status === 'success' && pendingTx.txHash && (
        <a
          href={getExplorerTxUrl(pendingTx.txHash, network)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
        >
          View
        </a>
      )}

      {!isBusy && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss transaction status"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
