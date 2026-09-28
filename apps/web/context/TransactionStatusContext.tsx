'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import type { StellarNetwork } from '@/lib/constants';
import { MevSubmissionError, waitForRpcConfirmation } from '@/lib/mev-submission';

export type PendingTxStatus = 'signing' | 'submitting' | 'pending' | 'success' | 'error';

export interface PendingTx {
  /** Short label describing the transaction, e.g. "Swap USDC → XLM". */
  label: string;
  status: PendingTxStatus;
  txHash: string | null;
  errorMessage?: string;
  errorCode?: string;
  rpcUrl?: string;
  network?: StellarNetwork;
}

export interface TransactionStatusContextValue {
  pendingTx: PendingTx | null;
  /** Publish a status update, or `null` to clear the indicator. */
  reportTx: (tx: PendingTx | null) => void;
  dismiss: () => void;
}

const STORAGE_KEY = 'swyft_pending_tx';

const defaultValue: TransactionStatusContextValue = {
  pendingTx: null,
  reportTx: () => {},
  dismiss: () => {},
};

const TransactionStatusContext = createContext<TransactionStatusContextValue>(defaultValue);

export function TransactionStatusProvider({ children }: { children: ReactNode }) {
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null);
  const hydrated = useRef(false);

  // Restore the last known status (e.g. after an accidental remount) but
  // never resume a "signing"/"submitting" state — the in-flight promise
  // that would eventually resolve it is gone, so treat it as stale.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PendingTx;
      if (
        parsed.status === 'success' ||
        parsed.status === 'error' ||
        (parsed.status === 'pending' && parsed.txHash && parsed.rpcUrl)
      ) {
        setPendingTx(parsed);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const reportTx = useCallback((tx: PendingTx | null) => {
    setPendingTx(tx);
    if (tx) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tx));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const dismiss = useCallback(() => {
    reportTx(null);
  }, [reportTx]);

  useEffect(() => {
    if (
      pendingTx?.status !== 'pending' ||
      !pendingTx.txHash ||
      !pendingTx.rpcUrl
    ) {
      return;
    }

    const controller = new AbortController();
    void waitForRpcConfirmation(pendingTx.txHash, pendingTx.rpcUrl, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) reportTx({ ...pendingTx, status: 'success' });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const errorMessage =
          cause instanceof MevSubmissionError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'Transaction confirmation failed';
        reportTx({
          ...pendingTx,
          status: 'error',
          errorMessage,
          errorCode: cause instanceof MevSubmissionError ? cause.code ?? undefined : undefined,
        });
      });

    return () => controller.abort();
  }, [pendingTx, reportTx]);

  return (
    <TransactionStatusContext.Provider value={{ pendingTx, reportTx, dismiss }}>
      {children}
    </TransactionStatusContext.Provider>
  );
}

export function useTransactionStatus(): TransactionStatusContextValue {
  return useContext(TransactionStatusContext);
}
