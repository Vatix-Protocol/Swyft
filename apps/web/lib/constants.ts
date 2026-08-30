/**
 * Web-app runtime constants.
 *
 * Network identifiers, passphrases, and explorer helpers are sourced from
 * @swyft/config so the monorepo has a single source of truth for these values.
 * Only web-specific values (localStorage keys, API base URL) live here.
 */

import {
  NETWORK_PRESETS,
  isStellarNetwork,
  getNetworkPassphrase,
  getExplorerTxUrl,
} from '@swyft/config';
import type { StellarNetwork } from '@swyft/config';

// Re-export so existing web components keep working without touching their
// import paths.
export { NETWORK_PRESETS, isStellarNetwork, getNetworkPassphrase, getExplorerTxUrl };
export type { StellarNetwork };

// ── Web-specific constants ────────────────────────────────────────────────────

/** Build-time default network, sourced from the environment. */
const _rawNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
export const SWYFT_NETWORK: StellarNetwork = isStellarNetwork(_rawNetwork)
  ? _rawNetwork
  : 'TESTNET';

/** Passphrase for the build-time default network. */
export const SWYFT_NETWORK_PASSPHRASE = getNetworkPassphrase(SWYFT_NETWORK);

export const WALLET_STORAGE_KEY = 'swyft_wallet_address';
/** localStorage key for the user's runtime testnet/mainnet selection. */
export const NETWORK_STORAGE_KEY = 'swyft_selected_network';
export const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1`;
/** Source-of-truth doc for how estimated fee APR is calculated and its assumptions. */
export const FEE_APR_DOC_URL =
  'https://github.com/Vatix-Protocol/Swyft/blob/main/docs/FEE_APR_CALCULATION.md';

/**
 * Returns the API base URL (with the `/v1` suffix) for the given network.
 *
 * Resolution order per network:
 *   1. NEXT_PUBLIC_API_URL_TESTNET / NEXT_PUBLIC_API_URL_PUBLIC (per-network override)
 *   2. NEXT_PUBLIC_API_URL (shared fallback)
 *   3. http://localhost:3001 (local dev default)
 *
 * Each network must be able to point at its own API deployment: the runtime
 * network switcher routes quotes, indexer data, LP positions, and wallet
 * flows through this URL, so a PUBLIC/mainnet build must set
 * NEXT_PUBLIC_API_URL_PUBLIC or mainnet traffic silently uses the shared
 * (usually testnet/localhost) URL. A blank override (e.g. `VAR=` in .env) is
 * treated as unset so it falls through instead of yielding a broken `/v1` URL.
 */
export function getApiBase(network: StellarNetwork): string {
  const override =
    (network === 'TESTNET'
      ? process.env.NEXT_PUBLIC_API_URL_TESTNET
      : process.env.NEXT_PUBLIC_API_URL_PUBLIC) || undefined;
  const base = override ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return `${base}/v1`;
}
