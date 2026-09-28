'use client';

import { useState } from 'react';
import { buildBurnTx, buildCollectTx } from '@swyft/sdk';
import type { PositionSnapshot } from '@swyft/ui';
import { API_BASE } from '@/lib/constants';
import { isWalletRejection } from '@/lib/wallet-errors';
import { useNetworkContext } from '@/context/NetworkContext';
import { useTransactionStatus } from '@/context/TransactionStatusContext';

/** Lifecycle status of a remove-liquidity or collect-fees transaction. */
export type TxStatus = 'idle' | 'signing' | 'submitting' | 'success' | 'error';
/** Reason a transaction failed. */
export type TxError = 'rejected' | 'network' | 'failed' | 'already_closed' | null;

interface State {
  status: TxStatus;
  txError: TxError;
  txHash: string | null;
}

/**
 * Submits a signed XDR transaction to the Swyft API.
 * @param xdr - Base64-encoded signed transaction XDR.
 * @param authToken - Bearer token for API authentication.
 * @returns The transaction hash on success.
 * @throws {Error} "already_closed" if the position is already closed, "network" for other failures.
 */
async function submitXdr(xdr: string, authToken: string, apiBase: string): Promise<string> {
  const res = await fetch(`${apiBase}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ xdr }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'POSITION_CLOSED') throw new Error('already_closed');
    throw new Error('network');
  }
  const data = (await res.json()) as { hash: string; successful?: boolean };
  if (data.successful !== true) {
    throw new Error(data.successful === false ? 'failed' : 'network');
  }
  return data.hash;
}

/**
 * Hook for removing liquidity from a position or collecting uncollected fees.
 *
 * Signing is delegated to the `signXdr` parameter rather than calling
 * Freighter directly, so both Freighter and xBull work without this hook
 * knowing which wallet is active.  Pass `walletCtx.signTransaction` from
 * `useWalletContext()` in the calling component.
 *
 * @param position  - The position to act on, or null if not yet loaded.
 * @param authToken - Bearer token for API authentication, or null if unauthenticated.
 * @param signXdr   - Wallet signing function from the wallet context.
 * @returns Transaction state (`status`, `txError`, `txHash`) and action functions
 *   (`removeLiquidity`, `collectFees`, `reset`).
 */
export function useRemoveLiquidity(
  position: PositionSnapshot | null,
  authToken: string | null,
  signXdr?: ((xdr: string) => Promise<string>) | null
) {
  const [state, setState] = useState<State>({ status: 'idle', txError: null, txHash: null });
  const { apiBase, network } = useNetworkContext();
  const { reportTx } = useTransactionStatus();

  /** Resets transaction state back to idle. */
  function reset() {
    setState({ status: 'idle', txError: null, txHash: null });
  }

  /**
   * Removes a percentage of liquidity from the position.
   * @param pct - Percentage to remove (1–100).
   */
  async function removeLiquidity(pct: number) {
    if (!position || !authToken) {
      setState({ status: 'error', txError: 'network', txHash: null });
      return;
    }
    if (!signXdr) {
      setState({ status: 'error', txError: 'network', txHash: null });
      return;
    }

    setState({ status: 'signing', txError: null, txHash: null });
    reportTx({ label: 'Remove liquidity', status: 'signing', txHash: null, network });

    try {
      const { xdr } = buildBurnTx({
        positionId: position.id,
        poolId: position.poolId,
        liquidity: position.liquidity,
        liquidityBps: Math.round(pct * 100),
        ownerAddress: position.ownerWallet,
      });

      // Route through the wallet-context signer so Freighter and xBull
      // both work without this hook knowing which wallet is active.
      const signedXdr = await signXdr(xdr).catch((err: unknown) => {
        if (isWalletRejection(err)) {
          return null;
        }
        throw err;
      });

      if (!signedXdr) {
        setState({ status: 'error', txError: 'rejected', txHash: null });
        reportTx({
          label: 'Remove liquidity',
          status: 'error',
          txHash: null,
          errorMessage: 'Transaction signature was rejected',
          network,
        });
        return;
      }

      setState((s) => ({ ...s, status: 'submitting' }));
      reportTx({ label: 'Remove liquidity', status: 'submitting', txHash: null, network });
      const hash = await submitXdr(signedXdr, authToken, apiBase);
      setState({ status: 'success', txError: null, txHash: hash });
      reportTx({ label: 'Remove liquidity', status: 'success', txHash: hash, network });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const txError: TxError =
        msg === 'already_closed'
          ? 'already_closed'
          : isWalletRejection(e)
            ? 'rejected'
            : 'network';
            ? 'rejected'
            : 'network';
      setState({ status: 'error', txError, txHash: null });
      reportTx({
        label: 'Remove liquidity',
        status: 'error',
        txHash: null,
        errorMessage: msg || 'Transaction failed',
        network,
      });
    }
  }

  /** Collects uncollected fees from the position without removing liquidity. */
  async function collectFees() {
    if (!position || !authToken) {
      setState({ status: 'error', txError: 'network', txHash: null });
      return;
    }
    if (!signXdr) {
      setState({ status: 'error', txError: 'network', txHash: null });
      return;
    }

    setState({ status: 'signing', txError: null, txHash: null });
    reportTx({ label: 'Collect fees', status: 'signing', txHash: null, network });

    try {
      const { xdr } = buildCollectTx({
        positionId: position.id,
        poolId: position.poolId,
        ownerAddress: position.ownerWallet,
        ownerWallet: position.ownerWallet,
      });

      const signedXdr = await signXdr(xdr).catch((err: unknown) => {
        if (isWalletRejection(err)) {
          return null;
        }
        throw err;
      });

      if (!signedXdr) {
        setState({ status: 'error', txError: 'rejected', txHash: null });
        reportTx({
          label: 'Collect fees',
          status: 'error',
          txHash: null,
          errorMessage: 'Transaction signature was rejected',
          network,
        });
        return;
      }

      setState((s) => ({ ...s, status: 'submitting' }));
      reportTx({ label: 'Collect fees', status: 'submitting', txHash: null, network });
      const hash = await submitXdr(signedXdr, authToken, apiBase);
      setState({ status: 'success', txError: null, txHash: hash });
      reportTx({ label: 'Collect fees', status: 'success', txHash: hash, network });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const txError: TxError =
        msg === 'already_closed'
          ? 'already_closed'
          : isWalletRejection(e)
            ? 'rejected'
            : 'network';
      setState({ status: 'error', txError, txHash: null });
      reportTx({
        label: 'Collect fees',
        status: 'error',
        txHash: null,
        errorMessage: msg || 'Transaction failed',
        network,
      });
    }
  }

  return { ...state, removeLiquidity, collectFees, reset };
}

            ? 'rejected'
            : 'network';
      setState({ status: 'error', txError, txHash: null });
      reportTx({
        label: 'Collect fees',
        status: 'error',
        txHash: null,
        errorMessage: msg || 'Transaction failed',
        network,
      });
    }
  }

  return { ...state, removeLiquidity, collectFees, reset };
}
