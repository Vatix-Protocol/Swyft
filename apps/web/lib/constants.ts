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
