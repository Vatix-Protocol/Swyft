'use client';

import { useState } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { buildRerangeTx } from '@swyft/sdk';
import type { PositionSnapshot } from '@swyft/ui';
import { API_BASE, getNetworkPassphrase } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';

/** Lifecycle status of a rerange transaction. */
export type TxStatus = 'idle' | 'signing' | 'submitting' | 'success' | 'error';
/** Reason a transaction failed. */
export type TxError = 'rejected' | 'network' | null;

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
 * @throws {Error} "network" for other failures.
 */
async function submitXdr(xdr: string, authToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ xdr }),
  });
  if (!res.ok) {
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
 * Hook for reranging a position's liquidity (moving from old tick range to new tick range).
 * @param position - The position to act on, or null if not yet loaded.
 * @param authToken - Bearer token for API authentication, or null if unauthenticated.
 * @returns Transaction state (`status`, `txError`, `txHash`) and action functions
 *   (`rerange`, `reset`).
 */
export function useRerangeLiquidity(position: PositionSnapshot | null, authToken: string | null) {
  const { network } = useNetworkContext();
  const [state, setState] = useState<State>({ status: 'idle', txError: null, txHash: null });

  /** Resets transaction state back to idle. */
  function reset() {
    setState({ status: 'idle', txError: null, txHash: null });
  }

  /**
   * Reranges the position's liquidity to a new tick range.
   * @param newLowerTick - New lower tick bound.
   * @param newUpperTick - New upper tick bound.
   */
  async function rerange(newLowerTick: number, newUpperTick: number) {
    if (!position || !authToken) {
      setState({ status: 'error', txError: 'network', txHash: null });
      return;
    }

    setState({ status: 'signing', txError: null, txHash: null });

    try {
      const { xdr } = buildRerangeTx({
        positionId: position.id,
        poolId: position.poolId,
        ownerAddress: position.ownerWallet,
        liquidity: position.liquidity,
        newLowerTick,
        newUpperTick,
      });

      const signResult = await signTransaction(xdr, {
        networkPassphrase: getNetworkPassphrase(network),
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
        msg.includes('reject') || msg.includes('cancel') ? 'rejected' : 'network';
      setState({ status: 'error', txError, txHash: null });
    }
  }

  return { ...state, rerange, reset };
}
