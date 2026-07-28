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

/** Per-network API base URLs. The environment variable overrides the default
 *  for the build-time network; the other network uses its own default. */
const API_BASE_MAP: Record<StellarNetwork, string> = {
  TESTNET: `${process.env.NEXT_PUBLIC_API_URL_TESTNET ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1`,
  PUBLIC: `${process.env.NEXT_PUBLIC_API_URL_PUBLIC ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1`,
};

/** Returns the API base URL for the given network. */
export function getApiBase(network: StellarNetwork): string {
  return API_BASE_MAP[network];
}

export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === 'TESTNET' || value === 'PUBLIC';
}

export function getNetworkPassphrase(network: StellarNetwork): string {
  return network === 'PUBLIC'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';
}

export function getExplorerTxUrl(hash: string, network: StellarNetwork = SWYFT_NETWORK): string {
  return network === 'PUBLIC'
    ? `https://stellar.expert/explorer/public/tx/${hash}`
    : `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
