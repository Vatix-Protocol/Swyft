'use client';

import { useState } from 'react';
import { buildRerangeTx } from '@swyft/sdk';
import type { PositionSnapshot } from '@swyft/ui';
import { API_BASE } from '@/lib/constants';
import { isWalletRejection } from '@/lib/wallet-errors';

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

/**
 * Hook for reranging a position's liquidity (moving from old tick range to new tick range).
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
 *   (`rerange`, `reset`).
 */
export function useRerangeLiquidity(
  position: PositionSnapshot | null,
  authToken: string | null,
  signXdr?: ((xdr: string) => Promise<string>) | null
) {
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
    if (!signXdr) {
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
        return;
      }

      setState((s) => ({ ...s, status: 'submitting' }));
      const hash = await submitXdr(signedXdr, authToken);
      setState({ status: 'success', txError: null, txHash: hash });
    } catch (e: unknown) {
      const txError: TxError =
        isWalletRejection(e) ? 'rejected' : 'network';
      setState({ status: 'error', txError, txHash: null });
    }
  }

  return { ...state, rerange, reset };
}
