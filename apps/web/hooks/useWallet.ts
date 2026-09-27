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
import { SWYFT_NETWORK, WALLET_STORAGE_KEY, type StellarNetwork } from '@/lib/constants';

export type WalletError =
  | 'NOT_INSTALLED'
  | 'REJECTED'
  | 'WRONG_NETWORK'
  | 'UNSUPPORTED_WALLET'
  | null;

/**
 * Supported wallet kits.
 *
 * - 'freighter' — Freighter browser extension (fully implemented).
 * - 'xbull'     — xBull wallet via @creit.tech/stellar-wallets-kit
 *                 (implemented; requires the kit to be installed).
 */
export type WalletKind = 'freighter' | 'xbull';

/** localStorage key storing the last-used wallet kind so sessions can be
 *  restored with the same wallet the user originally connected with. */
export const WALLET_KIND_STORAGE_KEY = 'swyft_wallet_kind';

export interface WalletState {
  address: string | null;
  error: WalletError;
  connecting: boolean;
  /** True while the persisted session is being restored on mount */
  loading: boolean;
  /** Which wallet is currently connected (or was last attempted). */
  walletKind: WalletKind;
  connect: (kind?: WalletKind) => Promise<void>;
  disconnect: () => void;
  /**
   * Signs an XDR envelope using the active wallet.
   * Returns null when no wallet is connected — callers must guard before use.
   */
  signTransaction: ((xdr: string) => Promise<string>) | null;
}

// ── xBull helpers ─────────────────────────────────────────────────────────────

/**
 * Attempts to dynamically import the stellar-wallets-kit and return the
 * xBull module.  Returns null if the package is not installed or the
 * browser environment is unavailable.
 */
async function loadXbullKit() {
  try {
    // Dynamic import keeps the heavy kit out of the main JS bundle for
    // users who only ever use Freighter.
    const kit = await import('@creit.tech/stellar-wallets-kit');
    return kit;
  } catch {
    return null;
  }
}

/** In-memory singleton so we reuse the same kit instance across calls. */
let _xbullKitInstance: unknown | null = null;

async function getXbullKit() {
  if (_xbullKitInstance) return _xbullKitInstance as {
    address(): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: Record<string, unknown>): Promise<{ signedTxXdr: string }>;
  };

  const kit = await loadXbullKit();
  if (!kit) return null;

  // StellarWalletsKit from @creit.tech/stellar-wallets-kit ≥2.0
  if (typeof kit.StellarWalletsKit !== 'function') return null;

  const instance = new (kit.StellarWalletsKit as new (opts: unknown) => unknown)({
    network: SWYFT_NETWORK === 'PUBLIC' ? 'PUBLIC' : 'TESTNET',
    selectedWalletId: kit.XBULL_ID ?? 'xbull',
    modules: kit.allowAllModules ? kit.allowAllModules() : [],
  });

  _xbullKitInstance = instance;
  return instance as {
    address(): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: Record<string, unknown>): Promise<{ signedTxXdr: string }>;
  };
}

async function connectXbull(): Promise<string | null> {
  const kit = await getXbullKit();
  if (!kit) return null;
  try {
    const { address } = await kit.address();
    return address ?? null;
  } catch {
    return null;
  }
}

async function signXbull(xdr: string, networkPassphrase: string): Promise<string> {
  const kit = await getXbullKit();
  if (!kit) throw new Error('xBull wallet kit not available');
  const result = await kit.signTransaction(xdr, { networkPassphrase });
  return result.signedTxXdr;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @param targetNetwork - Network the connected wallet is expected to be on.
 *   Defaults to the build-time env network; pass the live selection from
 *   `useNetworkContext()` to validate against the user's runtime choice.
 * @param defaultWalletKind - Default wallet kind.  Ignored when restoring a
 *   persisted session — the stored kind is used instead.
 */
export function useWallet(
  targetNetwork: StellarNetwork = SWYFT_NETWORK,
  defaultWalletKind: WalletKind = 'freighter'
): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<WalletError>(null);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [walletKind, setWalletKind] = useState<WalletKind>(defaultWalletKind);

  // ── Freighter network guard ─────────────────────────────────────────────────

  const validateFreighterNetwork = useCallback(
    async (addr: string): Promise<boolean> => {
      const networkResult = await getNetwork();
      const network = 'network' in networkResult ? networkResult.network : networkResult;
      if ((network as string).toUpperCase() !== targetNetwork) {
        setError('WRONG_NETWORK');
        return false;
      }
      setAddress(addr);
      localStorage.setItem(WALLET_STORAGE_KEY, addr);
      setError(null);
      return true;
    },
    [targetNetwork]
  );

  // ── Session restore ─────────────────────────────────────────────────────────

  useEffect(() => {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    const storedKind = (localStorage.getItem(WALLET_KIND_STORAGE_KEY) as WalletKind) ?? 'freighter';

    (async () => {
      try {
        if (storedKind === 'xbull') {
          // Restore xBull session by re-fetching the address (no extra permission
          // prompt needed — the user already approved access in this origin).
          const addr = await connectXbull();
          if (addr && addr === stored) {
            setAddress(addr);
            setWalletKind('xbull');
            setError(null);
          }
        } else {
          // Freighter restore path
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
          if (addr) {
            setWalletKind('freighter');
            await validateFreighterNetwork(addr);
          }
        }
      } catch {
        localStorage.removeItem(WALLET_STORAGE_KEY);
        localStorage.removeItem(WALLET_KIND_STORAGE_KEY);
      } finally {
        setLoading(false);
      }
    })();
  }, [validateFreighterNetwork]);

  // ── Connect ─────────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (kind: WalletKind = defaultWalletKind) => {
      setError(null);
      setConnecting(true);

      try {
        if (kind === 'xbull') {
          const addr = await connectXbull();
          if (!addr) {
            // Kit not installed or user dismissed the modal
            setError('NOT_INSTALLED');
            return;
          }
          setAddress(addr);
          setWalletKind('xbull');
          localStorage.setItem(WALLET_STORAGE_KEY, addr);
          localStorage.setItem(WALLET_KIND_STORAGE_KEY, 'xbull');
          setError(null);
          return;
        }

        // ── Freighter path ──────────────────────────────────────────────────
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

        setWalletKind('freighter');
        localStorage.setItem(WALLET_KIND_STORAGE_KEY, 'freighter');
        await validateFreighterNetwork(addr);
      } catch {
        setError('REJECTED');
      } finally {
        setConnecting(false);
      }
    },
    [validateFreighterNetwork, defaultWalletKind]
  );

  // ── Disconnect ──────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
    localStorage.removeItem(WALLET_STORAGE_KEY);
    localStorage.removeItem(WALLET_KIND_STORAGE_KEY);
  }, []);

  // ── Sign transaction ────────────────────────────────────────────────────────

  /**
   * Signs an XDR transaction with whichever wallet is currently active.
   * Routing sign calls through the wallet context (rather than calling
   * Freighter directly in feature hooks) is the key invariant that makes
   * xBull work transparently for swap and liquidity flows.
   */
  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (walletKind === 'xbull') {
        // The network passphrase is embedded in the XDR; xBull kit reads it.
        return signXbull(xdr, targetNetwork);
      }

      // Freighter path
      const result = await freighterSignTx(xdr);
      if (typeof result === 'string') return result;
      if ('signedTxXdr' in result) return result.signedTxXdr;
      throw new Error('Signing rejected');
    },
    [walletKind, targetNetwork]
  );

  return {
    address,
    error,
    connecting,
    loading,
    walletKind,
    connect,
    disconnect,
    signTransaction: address ? signTransaction : null,
  };
}
