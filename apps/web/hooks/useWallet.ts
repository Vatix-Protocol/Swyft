'use client';

import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTx,
} from '@stellar/freighter-api';
import { useState, useEffect, useCallback } from 'react';
import { SWYFT_NETWORK, WALLET_STORAGE_KEY } from '@/lib/constants';

export type WalletError = 'NOT_INSTALLED' | 'REJECTED' | 'WRONG_NETWORK' | null;

export interface WalletState {
  address: string | null;
  error: WalletError;
  connecting: boolean;
  /** True while the persisted session is being restored on mount */
  loading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<WalletError>(null);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);

  const validateAndSet = useCallback(async (addr: string) => {
    const networkResult = await getNetwork();
    const network = 'network' in networkResult ? networkResult.network : networkResult;
    if ((network as string).toUpperCase() !== SWYFT_NETWORK) {
      setError('WRONG_NETWORK');
      return false;
    }
    setAddress(addr);
    localStorage.setItem(WALLET_STORAGE_KEY, addr);
    setError(null);
    return true;
  }, []);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const connected = await isConnected();
        const ok = 'isConnected' in connected ? connected.isConnected : connected;
        if (!ok) {
          setLoading(false);
          return;
        }

        const allowed = await isAllowed();
        const permitted = 'isAllowed' in allowed ? allowed.isAllowed : allowed;
        if (!permitted) {
          setLoading(false);
          return;
        }

        const result = await getAddress();
        const addr = 'address' in result ? result.address : (result as string);
        if (addr) await validateAndSet(addr);
      } catch {
        localStorage.removeItem(WALLET_STORAGE_KEY);
      } finally {
        setLoading(false);
      }
    })();
  }, [validateAndSet]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const connected = await isConnected();
      const ok = 'isConnected' in connected ? connected.isConnected : connected;
      if (!ok) {
        setError('NOT_INSTALLED');
        return;
      }

      const result = await requestAccess();
      const addr = 'address' in result ? result.address : (result as string);

      if (!addr) {
        setError('REJECTED');
        return;
      }

      await validateAndSet(addr);
    } catch {
      setError('REJECTED');
    } finally {
      setConnecting(false);
    }
  }, [validateAndSet]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
    localStorage.removeItem(WALLET_STORAGE_KEY);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    const result = await freighterSignTx(xdr);
    if (typeof result === 'string') return result;
    if ('signedTxXdr' in result) return result.signedTxXdr;
    throw new Error('Signing rejected');
  }, []);

  return { address, error, connecting, loading, connect, disconnect, signTransaction };
}
