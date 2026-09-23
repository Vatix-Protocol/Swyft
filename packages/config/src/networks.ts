/**
 * @swyft/config — Network presets
 *
 * Single source of truth for Stellar network identifiers, passphrases,
 * default RPC/Horizon URLs, and explorer link helpers.
 *
 * Both apps/web and apps/api import from here so the values stay in sync
 * and only need to be updated in one place.
 *
 * Supported networks:
 *   TESTNET — Stellar Test SDF Network (Futurenet-compatible)
 *   PUBLIC  — Stellar public mainnet
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** The two networks Swyft supports. */
export type StellarNetwork = 'TESTNET' | 'PUBLIC';

/** Full preset for a single network. */
export interface NetworkPreset {
  /** Human-readable label used in UI dropdowns. */
  label: string;
  /**
   * Stellar network passphrase — required by Freighter and the Soroban SDK
   * for transaction signing and XDR encoding.
   */
  passphrase: string;
  /** Default Soroban JSON-RPC endpoint for this network. */
  rpcUrl: string;
  /** Default Horizon REST API endpoint for this network. */
  horizonUrl: string;
  /** Base URL for the Stellar Expert block explorer on this network. */
  explorerBaseUrl: string;
}

// ── Presets ───────────────────────────────────────────────────────────────────

/**
 * Canonical network presets keyed by {@link StellarNetwork}.
 *
 * @example
 * ```ts
 * import { NETWORK_PRESETS } from '@swyft/config';
 * const { rpcUrl } = NETWORK_PRESETS.TESTNET;
 * ```
 */
export const NETWORK_PRESETS: Record<StellarNetwork, NetworkPreset> = {
  TESTNET: {
    label: 'Testnet',
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
  },
  PUBLIC: {
    label: 'Mainnet',
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban-mainnet.stellar.org',
    horizonUrl: 'https://horizon.stellar.org',
    explorerBaseUrl: 'https://stellar.expert/explorer/public',
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Type-guard: returns `true` when `value` is a valid {@link StellarNetwork}.
 *
 * @example
 * ```ts
 * const raw = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
 * const network = isStellarNetwork(raw) ? raw : 'TESTNET';
 * ```
 */
export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === 'TESTNET' || value === 'PUBLIC';
}

/**
 * Returns the network passphrase for the given {@link StellarNetwork}.
 *
 * @example
 * ```ts
 * getNetworkPassphrase('PUBLIC');
 * // → 'Public Global Stellar Network ; September 2015'
 * ```
 */
export function getNetworkPassphrase(network: StellarNetwork): string {
  return NETWORK_PRESETS[network].passphrase;
}

/**
 * Returns the default Soroban RPC URL for the given {@link StellarNetwork}.
 */
export function getNetworkRpcUrl(network: StellarNetwork): string {
  return NETWORK_PRESETS[network].rpcUrl;
}

/**
 * Returns the default Horizon URL for the given {@link StellarNetwork}.
 */
export function getNetworkHorizonUrl(network: StellarNetwork): string {
  return NETWORK_PRESETS[network].horizonUrl;
}

/**
 * Builds a Stellar Expert explorer URL for a transaction hash.
 *
 * @example
 * ```ts
 * getExplorerTxUrl('abc123', 'TESTNET');
 * // → 'https://stellar.expert/explorer/testnet/tx/abc123'
 * ```
 */
export function getExplorerTxUrl(hash: string, network: StellarNetwork = 'TESTNET'): string {
  return `${NETWORK_PRESETS[network].explorerBaseUrl}/tx/${hash}`;
}
