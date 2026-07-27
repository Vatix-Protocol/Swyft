'use client';

import { useEffect, useRef, useState } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { buildSwapTx, toRawAmount, toStellarAddress } from '@swyft/sdk';
import type { SwapQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { API_BASE, getNetworkPassphrase } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';
import { useTransactionStatus } from '@/context/TransactionStatusContext';

export type SwapStatus = 'idle' | 'signing' | 'submitting' | 'success' | 'error';
export type SwapError = 'rejected' | 'slippage' | 'network' | null;

interface SwapResult {
  status: SwapStatus;
  error: SwapError;
  txHash: string | null;
  /** Raw Horizon/RPC error detail, when the backend provided one. */
  detail: string | null;
}

interface ExecuteParams {
  poolId: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  quote: SwapQuote;
  walletAddress: string;
}

const ERROR_MESSAGES: Record<Exclude<SwapError, null>, string> = {
  rejected: 'Swap rejected in wallet',
  slippage: 'Price moved beyond slippage tolerance',
  network: 'Network error — swap could not be submitted',
};

export function useSwapExecution() {
  const { network } = useNetworkContext();
  const { reportTx } = useTransactionStatus();
  const labelRef = useRef('Swap');
  const [result, setResult] = useState<SwapResult>({
    status: 'idle',
    error: null,
    txHash: null,
    detail: null,
  });

  // Mirror local swap status into the app-wide indicator so it stays
  // visible even after the confirmation modal closes. 'idle' also covers
  // a silent wallet-rejection, which must clear a stuck "signing" pill.
  useEffect(() => {
    if (result.status === 'idle') {
      reportTx(null);
      return;
    }
    if (result.status === 'success' || result.status === 'error') {
      reportTx({
        label: labelRef.current,
        status: result.status,
        txHash: result.txHash,
        errorMessage: result.detail ?? (result.error ? ERROR_MESSAGES[result.error] : undefined),
      });
      return;
    }
    reportTx({ label: labelRef.current, status: result.status, txHash: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.status, result.txHash, result.error, result.detail]);

  function reset() {
    setResult({ status: 'idle', error: null, txHash: null, detail: null });
  }

  async function execute(params: ExecuteParams) {
    const { poolId, tokenIn, tokenOut, amountIn, quote, walletAddress } = params;

    labelRef.current = `${tokenIn.symbol} → ${tokenOut.symbol} swap`;
    setResult({ status: 'signing', error: null, txHash: null, detail: null });

    try {
      const { xdr } = buildSwapTx({
        poolId: toStellarAddress(poolId),
        tokenInId: toStellarAddress(tokenIn.id),
        tokenOutId: toStellarAddress(tokenOut.id),
        amountIn: toRawAmount(amountIn),
        minimumReceived: toRawAmount(quote.minimumReceived),
        ownerAddress: toStellarAddress(walletAddress),
      });

      const signResult = await signTransaction(xdr, {
        networkPassphrase: getNetworkPassphrase(network),
      });
      const signedXdr =
        typeof signResult === 'string'
          ? signResult
          : 'signedTxXdr' in signResult
            ? (signResult as { signedTxXdr: string }).signedTxXdr
            : null;

      if (!signedXdr) {
        setResult({ status: 'idle', error: null, txHash: null, detail: null });
        return;
      }

      setResult({ status: 'submitting', error: null, txHash: null, detail: null });

      const res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr: signedXdr }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          extras?: { result_codes?: unknown };
        };
        const error: SwapError = body.code === 'SLIPPAGE_EXCEEDED' ? 'slippage' : 'network';
        // Surface the Horizon/RPC detail so it reaches TransactionStatusIndicator
        // instead of only being visible in a network trace.
        const detail =
          typeof body.message === 'string'
            ? body.extras?.result_codes
              ? `${body.message} (${JSON.stringify(body.extras.result_codes)})`
              : body.message
            : null;
        setResult({ status: 'error', error, txHash: null, detail });
        return;
      }

      const data = (await res.json()) as { hash: string };
      setResult({ status: 'success', error: null, txHash: data.hash, detail: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) {
        // User rejected in wallet — close silently
        setResult({ status: 'idle', error: null, txHash: null, detail: null });
        return;
      }
      setResult({ status: 'error', error: 'network', txHash: null, detail: msg || null });
    }
  }

  return { ...result, execute, reset };
}
