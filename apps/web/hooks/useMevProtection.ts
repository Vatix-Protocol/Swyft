'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'swyft:mev_protection';

/**
 * Public Stellar testnet Soroban RPC used as an unconditional fallback.
 * The actual endpoint comes from env vars; this value is intentionally a
 * publicly accessible URL (no credentials) so the app degrades safely.
 */
const TESTNET_FALLBACK_RPC = 'https://soroban-testnet.stellar.org';

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
 * validation and safe fallback.
 *
 * Priority (highest → lowest):
 *   1. `NEXT_PUBLIC_MEV_PROTECTED_RPC_URL` — when MEV protection is enabled
 *   2. `NEXT_PUBLIC_SOROBAN_RPC_URL`
 *   3. Hardcoded testnet fallback
 *
 * Invalid (malformed) env var values are silently ignored and the next
 * candidate in the priority chain is tried.
 *
 * @internal — exported for testing only.
 */
export function resolveRpcUrl(mevEnabled: boolean): string {
  const sorobanUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const mevUrl = process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL;

  if (mevEnabled && isValidRpcUrl(mevUrl)) {
    return mevUrl;
  }

  if (isValidRpcUrl(sorobanUrl)) {
    return sorobanUrl;
  }

  return TESTNET_FALLBACK_RPC;
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
   * Whether a valid MEV-protected RPC endpoint is configured via
   * NEXT_PUBLIC_MEV_PROTECTED_RPC_URL. When `enabled` is true but
   * `available` is false, swaps will fail explicitly rather than
   * silently falling back to the public RPC.
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
}

/**
 * Manages MEV-protection preference (persisted in `localStorage`) and
 * exposes the correct Soroban RPC URL for the active protection mode.
 *
 * - Reads the stored preference **only on the client** (inside `useEffect`)
 *   to avoid SSR hydration mismatches.
 * - Both env var values are validated; an invalid or missing URL gracefully
 *   falls back to the public Stellar testnet endpoint.
 */
export function useMevProtection(): MevProtectionState {
  const [enabled, setEnabled] = useState(false);

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

  const available = isMevEndpointConfigured();

  // Warn once in production if MEV is enabled but the endpoint is missing
  useEffect(() => {
    if (enabled && !available && process.env.NODE_ENV === 'production') {
      console.warn(
        '[Swyft] MEV protection is enabled but NEXT_PUBLIC_MEV_PROTECTED_RPC_URL ' +
          'is not configured. Swaps will fail. Set a valid https:// endpoint or ' +
          'disable MEV protection.',
      );
    }
  }, [enabled, available]);

  return {
    enabled,
    available,
    toggle,
    rpcUrl: resolveRpcUrl(enabled),
  };
}
