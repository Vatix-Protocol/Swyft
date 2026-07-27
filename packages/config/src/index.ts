/**
 * @swyft/config
 *
 * Shared configuration primitives for the Swyft monorepo.
 * Import from this package in both apps/web and apps/api.
 *
 * @example
 * ```ts
 * import { NETWORK_PRESETS, getNetworkPassphrase, type StellarNetwork } from '@swyft/config';
 * ```
 */
export {
  NETWORK_PRESETS,
  isStellarNetwork,
  getNetworkPassphrase,
  getNetworkRpcUrl,
  getNetworkHorizonUrl,
  getExplorerTxUrl,
} from './networks';

export type { StellarNetwork, NetworkPreset } from './networks';
