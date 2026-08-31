'use client';

import { useEffect, useRef, useState } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { buildSwapTx, buildExactOutputSwapTx, toRawAmount, toStellarAddress } from '@swyft/sdk';
import type { SwapQuote, ExactOutputQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { API_BASE, ROUTER_ADDRESS, getNetworkPassphrase } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';
import { useTransactionStatus } from '@/context/TransactionStatusContext';
import { submitTransaction, MevSubmissionError } from '@/lib/mev-submission';
import { useMevProtection } from './useMevProtection';

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

interface ExecuteExactOutputParams {
  /** Pool fee tier to route through (see {@link ExactOutputQuote}). */
  fee: number;
  tokenIn: Token;
  tokenOut: Token;
  /** Exact amount of `tokenOut` desired. */
  amountOut: string;
  quote: ExactOutputQuote;
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
  const { enabled: mevEnabled, mevRpcUrl } = useMevProtection();
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

      try {
        const { hash } = await submitTransaction({
          signedXdr,
          apiBase: API_BASE,
          mevEnabled,
          mevRpcUrl,
        });
        setResult({ status: 'success', error: null, txHash: hash, detail: null });
      } catch (submitErr) {
        const error: SwapError =
          submitErr instanceof MevSubmissionError && submitErr.code === 'SLIPPAGE_EXCEEDED'
            ? 'slippage'
            : 'network';
        const detail =
          submitErr instanceof MevSubmissionError
            ? submitErr.detail
              ? `${submitErr.message} (${submitErr.detail})`
              : submitErr.message
            : submitErr instanceof Error
              ? submitErr.message
              : null;
        setResult({ status: 'error', error, txHash: null, detail });
        return;
      }
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

  async function executeExactOutput(params: ExecuteExactOutputParams) {
    const { fee, tokenIn, tokenOut, amountOut, quote, walletAddress } = params;

    if (!ROUTER_ADDRESS) {
      setResult({
        status: 'error',
        error: 'network',
        txHash: null,
        detail: 'Exact-output swaps are unavailable: router address is not configured',
      });
      return;
    }

    labelRef.current = `${tokenIn.symbol} → ${tokenOut.symbol} swap`;
    setResult({ status: 'signing', error: null, txHash: null, detail: null });

    try {
      const { xdr } = buildExactOutputSwapTx({
        routerId: toStellarAddress(ROUTER_ADDRESS),
        tokenInId: toStellarAddress(tokenIn.id),
        tokenOutId: toStellarAddress(tokenOut.id),
        fee,
        amountOut: toRawAmount(amountOut),
        amountInMax: toRawAmount(quote.maximumIn),
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
        setResult({ status: 'idle', error: null, txHash: null, detail: null });
        return;
      }
      setResult({ status: 'error', error: 'network', txHash: null, detail: msg || null });
    }
  }

  return { ...result, execute, executeExactOutput, reset };
}
