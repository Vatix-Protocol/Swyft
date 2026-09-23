'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export type PendingTxStatus = 'signing' | 'submitting' | 'success' | 'error';

export interface PendingTx {
  /** Short label describing the transaction, e.g. "Swap USDC → XLM". */
  label: string;
  status: PendingTxStatus;
  txHash: string | null;
  errorMessage?: string;
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
      if (parsed.status === 'success' || parsed.status === 'error') {
        setPendingTx(parsed);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function reportTx(tx: PendingTx | null) {
    setPendingTx(tx);
    if (tx) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tx));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function dismiss() {
    reportTx(null);
  }

  return (
    <TransactionStatusContext.Provider value={{ pendingTx, reportTx, dismiss }}>
      {children}
    </TransactionStatusContext.Provider>
  );
}

export function useTransactionStatus(): TransactionStatusContextValue {
  return useContext(TransactionStatusContext);
}
