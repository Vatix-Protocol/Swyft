'use client';

import { useState, useEffect } from 'react';
import { getNetworkRpcUrl, type StellarNetwork } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';

const STORAGE_KEY = 'swyft:mev_protection';

/**
 * Returns `true` when `url` is a syntactically valid http(s) URL.
 * Rejects empty strings, relative paths, and non-http schemes.
 *
 * @internal — exported for testing only.
 */
export function isValidRpcUrl(url: string | undefined | null): url is string {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves the active Soroban RPC URL from environment variables with
 * validation and a network-specific public RPC fallback.
 *
 * Priority (highest → lowest):
 *   1. `NEXT_PUBLIC_MEV_PROTECTED_RPC_URL` — when MEV protection is enabled
 *   2. `NEXT_PUBLIC_SOROBAN_RPC_URL`
 *   3. Public RPC for the selected Stellar network
 *
 * Invalid (malformed) env var values are silently ignored and the next
 * candidate in the priority chain is tried.
 *
 * @internal — exported for testing only.
 */
export function resolveRpcUrl(
  mevEnabled: boolean,
  network: StellarNetwork = 'TESTNET',
): string {
  const sorobanUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const mevUrl = process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL;

  if (mevEnabled && isValidRpcUrl(mevUrl)) {
    return mevUrl;
  }

  if (isValidRpcUrl(sorobanUrl)) {
    return sorobanUrl;
  }

  return getNetworkRpcUrl(network);
}

/**
 * Returns true when a valid MEV-protected RPC endpoint is configured.
 * Exported for use in non-hook contexts (e.g. server-side validation).
 *
 * @internal — exported for testing only.
 */
export function isMevEndpointConfigured(): boolean {
  return isValidRpcUrl(process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL);
}

export interface MevProtectionState {
  /** Whether MEV protection is currently enabled by the user. */
  enabled: boolean;
  /**
   * Whether a valid MEV-protected RPC endpoint is configured.
   * When `enabled` is true but `available` is false, the UI should
   * warn the user that MEV protection cannot be provided.
   */
  available: boolean;
  /**
   * Toggle MEV protection on/off and persist the preference to
   * `localStorage`. Idempotent — calling with the current value is a no-op.
   */
  toggle: (value: boolean) => void;
  /**
   * The resolved Soroban RPC URL to use for the current session.
   * Always a valid http(s) URL — never an empty string or undefined.
   */
  rpcUrl: string;
  /**
   * The raw MEV-protected RPC URL from the environment, or undefined
   * if not set / invalid. Passed to mev-submission for direct RPC calls.
   */
  mevRpcUrl: string | undefined;
}

/**
 * Manages MEV-protection preference (persisted in `localStorage`) and
 * exposes the correct Soroban RPC URL for the active protection mode.
 *
 * - Reads the stored preference **only on the client** (inside `useEffect`)
 *   to avoid SSR hydration mismatches.
 * - Both env var values are validated; an invalid or missing URL falls back
 *   to the public RPC for the selected Stellar network.
 */
export function useMevProtection(): MevProtectionState {
  const [enabled, setEnabled] = useState(false);
  const { network } = useNetworkContext();

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // localStorage may be unavailable (e.g. private browsing restrictions).
      setEnabled(false);
    }
  }, []);

  const toggle = (value: boolean) => {
    setEnabled(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Persist failure is non-fatal — the in-memory state is still updated.
    }
  };

  const mevUrl = process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL;
  const available = isValidRpcUrl(mevUrl);

  return {
    enabled,
    available,
    toggle,
    rpcUrl: resolveRpcUrl(enabled, network),
    mevRpcUrl: available ? mevUrl : undefined,
  };
}
