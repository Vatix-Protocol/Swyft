'use client';

import { useEffect, useRef, useState } from 'react';
import { buildSwapTx, buildExactOutputSwapTx, toRawAmount, toStellarAddress } from '@swyft/sdk';
import type { SwapQuote, ExactOutputQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { ROUTER_ADDRESS } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';
import { useWalletContext } from '@/context/WalletContext';
import { useTransactionStatus } from '@/context/TransactionStatusContext';
import { submitTransaction, MevSubmissionError } from '@/lib/mev-submission';
import { useMevProtection } from './useMevProtection';
import { isWalletRejection, WALLET_REJECTION_MESSAGE } from '@/lib/wallet-errors';

export type SwapStatus = 'idle' | 'signing' | 'submitting' | 'pending' | 'success' | 'error';
export type SwapError = 'rejected' | 'slippage' | 'network' | 'failed' | null;

interface SwapResult {
  status: SwapStatus;
  error: SwapError;
  txHash: string | null;
  /** Raw Horizon/RPC error detail, when the backend provided one. */
  detail: string | null;
}

export interface ExecuteParams {
  poolId: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  quote: SwapQuote;
  walletAddress: string;
}

export interface ExecuteExactOutputParams {
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
  failed: 'Swap failed on-chain',
};

const IDLE: SwapResult = { status: 'idle', error: null, txHash: null, detail: null };

export function useSwapExecution() {
  const { reportTx } = useTransactionStatus();
  const { enabled: mevEnabled, mevRpcUrl } = useMevProtection();
  const { apiBase } = useNetworkContext();
  // Route all signing through the wallet context so xBull and Freighter both work.
  const { signTransaction } = useWalletContext();
  const labelRef = useRef('Swap');
  const [result, setResult] = useState<SwapResult>(IDLE);

  // Mirror local swap status into the app-wide indicator so it stays
  // visible even after the confirmation modal closes.
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
    setResult(IDLE);
  }

  function fail(error: Exclude<SwapError, null>, detail: string | null) {
    setResult({ status: 'error', error, txHash: null, detail });
  }

  async function signAndSubmit(tokenIn: Token, tokenOut: Token, buildXdr: () => string) {
    if (!signTransaction) {
      fail('network', 'Wallet not connected');
      return;
    }

    labelRef.current = `${tokenIn.symbol} → ${tokenOut.symbol} swap`;
    setResult({ status: 'signing', error: null, txHash: null, detail: null });

    let signedXdr: string | null;
    try {
      signedXdr = await signTransaction(buildXdr());
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        fail('rejected', WALLET_REJECTION_MESSAGE);
        return;
      }
      fail('network', e instanceof Error ? e.message || null : null);
      return;
    }

    if (!signedXdr) {
      fail('rejected', WALLET_REJECTION_MESSAGE);
      return;
    }

    setResult({ status: 'submitting', error: null, txHash: null, detail: null });

    try {
      const { hash } = await submitTransaction({ signedXdr, apiBase, mevEnabled, mevRpcUrl });
      setResult({ status: 'success', error: null, txHash: hash, detail: null });
    } catch (e: unknown) {
      if (e instanceof MevSubmissionError) {
        fail(
          e.code === 'SLIPPAGE_EXCEEDED' ? 'slippage' : 'network',
          e.detail ? `${e.message} (${e.detail})` : e.message
        );
        return;
      }
      fail('network', e instanceof Error ? e.message : null);
    }
  }

  function execute({ poolId, tokenIn, tokenOut, amountIn, quote, walletAddress }: ExecuteParams) {
    return signAndSubmit(
      tokenIn,
      tokenOut,
      () =>
        buildSwapTx({
          poolId: toStellarAddress(poolId),
          tokenInId: toStellarAddress(tokenIn.id),
          tokenOutId: toStellarAddress(tokenOut.id),
          amountIn: toRawAmount(amountIn),
          minimumReceived: toRawAmount(quote.minimumReceived),
          ownerAddress: toStellarAddress(walletAddress),
        }).xdr
    );
  }

  function executeExactOutput(params: ExecuteExactOutputParams) {
    const { fee, tokenIn, tokenOut, amountOut, quote, walletAddress } = params;
    if (!ROUTER_ADDRESS) {
      fail('network', 'Exact-output swaps are unavailable: router address is not configured');
      return Promise.resolve();
    }
    return signAndSubmit(
      tokenIn,
      tokenOut,
      () =>
        buildExactOutputSwapTx({
          routerId: toStellarAddress(ROUTER_ADDRESS),
          tokenInId: toStellarAddress(tokenIn.id),
          tokenOutId: toStellarAddress(tokenOut.id),
          fee,
          amountOut: toRawAmount(amountOut),
          amountInMax: toRawAmount(quote.maximumIn),
          ownerAddress: toStellarAddress(walletAddress),
        }).xdr
    );
  }

  return { ...result, execute, executeExactOutput, reset };
}
