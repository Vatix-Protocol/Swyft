'use client';

import { useState } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { buildBurnTx, buildCollectTx } from '@swyft/sdk';
import type { PositionSnapshot } from '@swyft/ui';
import { API_BASE, SWYFT_NETWORK_PASSPHRASE } from '@/lib/constants';

/** Lifecycle status of a remove-liquidity or collect-fees transaction. */
export type TxStatus = 'idle' | 'signing' | 'submitting' | 'success' | 'error';
/** Reason a transaction failed. */
export type TxError = 'rejected' | 'network' | 'already_closed' | null;

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
async function submitXdr(xdr: string, authToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ xdr }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'POSITION_CLOSED') throw new Error('already_closed');
    throw new Error('network');
  }
  const data = (await res.json()) as { hash: string };
  return data.hash;
}

function resolveSignedXdr(signResult: unknown): string | null {
  if (typeof signResult === 'string') return signResult;
  if (signResult && typeof signResult === 'object' && 'signedTxXdr' in signResult) {
    return (signResult as { signedTxXdr: string }).signedTxXdr;
  }
  return null;
}

/**
 * Hook for removing liquidity from a position or collecting uncollected fees.
 * @param position - The position to act on, or null if not yet loaded.
 * @param authToken - Bearer token for API authentication, or null if unauthenticated.
 * @returns Transaction state (`status`, `txError`, `txHash`) and action functions
 *   (`removeLiquidity`, `collectFees`, `reset`).
 */
export function useRemoveLiquidity(position: PositionSnapshot | null, authToken: string | null) {
  const [state, setState] = useState<State>({ status: 'idle', txError: null, txHash: null });

  /** Resets transaction state back to idle. */
  function reset() {
    setState({ status: 'idle', txError: null, txHash: null });
  }

  /**
   * Removes a percentage of liquidity from the position.
   * @param pct - Percentage to remove (1–100).
   */
  async function removeLiquidity(pct: number) {
    if (!position || !authToken) return;
    setState({ status: 'signing', txError: null, txHash: null });

    try {
      const { xdr } = buildBurnTx({
        positionId: position.id,
        poolId: position.poolId,
        liquidity: position.liquidity,
        liquidityBps: Math.round(pct * 100),
        ownerAddress: position.ownerWallet,
      });

      const signResult = await signTransaction(xdr, {
        networkPassphrase: SWYFT_NETWORK_PASSPHRASE,
      });
      const signedXdr = resolveSignedXdr(signResult);

      if (!signedXdr) {
        setState({ status: 'error', txError: 'rejected', txHash: null });
        return;
      }

      setState((s) => ({ ...s, status: 'submitting' }));
      const hash = await submitXdr(signedXdr, authToken);
      setState({ status: 'success', txError: null, txHash: hash });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const txError: TxError =
        msg === 'already_closed'
          ? 'already_closed'
          : msg.includes('reject') || msg.includes('cancel')
            ? 'rejected'
            : 'network';
      setState({ status: 'error', txError, txHash: null });
    }
  }

  /** Collects uncollected fees from the position without removing liquidity. */
  async function collectFees() {
    if (!position || !authToken) return;
    setState({ status: 'signing', txError: null, txHash: null });

    try {
      const { xdr } = buildCollectTx({
        positionId: position.id,
        poolId: position.poolId,
        ownerAddress: position.ownerWallet,
      });

      const signResult = await signTransaction(xdr, {
        networkPassphrase: SWYFT_NETWORK_PASSPHRASE,
      });
      const signedXdr = resolveSignedXdr(signResult);

      if (!signedXdr) {
        setState({ status: 'error', txError: 'rejected', txHash: null });
        return;
      }

      setState((s) => ({ ...s, status: 'submitting' }));
      const hash = await submitXdr(signedXdr, authToken);
      setState({ status: 'success', txError: null, txHash: hash });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const txError: TxError =
        msg === 'already_closed'
          ? 'already_closed'
          : msg.includes('reject') || msg.includes('cancel')
            ? 'rejected'
            : 'network';
      setState({ status: 'error', txError, txHash: null });
    }
  }

  return { ...state, removeLiquidity, collectFees, reset };
}
