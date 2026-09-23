import { registerAs } from '@nestjs/config';

/**
 * Stellar network configuration (issue #988).
 *
 * Fail-closed network safety: the API must never silently fall back to a
 * default network. An explicit STELLAR_NETWORK selection is required, and the
 * Horizon / Soroban RPC endpoints and the network passphrase are derived from
 * that selection so testnet vs mainnet address drift cannot occur.
 *
 * Stable error codes are surfaced so callers and ops can react deterministically
 * without leaking secrets (no keys, no full config dumps).
 */

export type StellarNetwork = 'testnet' | 'mainnet';

export const STELLAR_CONFIG_ERROR_CODES = {
  MISSING_NETWORK: 'STELLAR_CONFIG_MISSING_NETWORK',
  INVALID_NETWORK: 'STELLAR_CONFIG_INVALID_NETWORK',
  MISSING_HORIZON_URL: 'STELLAR_CONFIG_MISSING_HORIZON_URL',
  MISSING_RPC_URL: 'STELLAR_CONFIG_MISSING_RPC_URL',
  MISSING_PASSPHRASE: 'STELLAR_CONFIG_MISSING_PASSPHRASE',
  PASSPHRASE_NETWORK_MISMATCH: 'STELLAR_CONFIG_PASSPHRASE_NETWORK_MISMATCH',
  MAINNET_NOT_ENABLED: 'STELLAR_CONFIG_MAINNET_NOT_ENABLED',
} as const;

export type StellarConfigErrorCode =
  (typeof STELLAR_CONFIG_ERROR_CODES)[keyof typeof STELLAR_CONFIG_ERROR_CODES];

export class StellarConfigError extends Error {
  readonly code: StellarConfigErrorCode;
  readonly correlationId: string;

  constructor(code: StellarConfigErrorCode, message: string, correlationId?: string) {
    super(message);
    this.name = 'StellarConfigError';
    this.code = code;
    this.correlationId = correlationId ?? `stellar-config-${Date.now().toString(36)}`;
  }
}

/** Canonical network passphrases — the source of truth for address drift. */
export const STELLAR_NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
};

/** Default public endpoints per network (overridable via env). */
export const STELLAR_NETWORK_DEFAULTS: Record<
  StellarNetwork,
  { horizonUrl: string; rpcUrl: string }
> = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  mainnet: {
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: 'https://soroban-mainnet.stellar.org',
  },
};

export interface StellarConfig {
  network: StellarNetwork;
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** True only when mainnet is explicitly enabled via STELLAR_MAINNET_ENABLED. */
  mainnetEnabled: boolean;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Resolve and validate the Stellar network configuration.
 *
 * Deny-by-default: an unset or unrecognized STELLAR_NETWORK throws rather than
 * defaulting. Selecting mainnet additionally requires STELLAR_MAINNET_ENABLED
 * so a money-path network switch cannot happen implicitly.
 */
export function resolveStellarConfig(
  env: NodeJS.ProcessEnv = process.env,
  correlationId?: string,
): StellarConfig {
  const rawNetwork = env.STELLAR_NETWORK?.trim().toLowerCase();

  if (!rawNetwork) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.MISSING_NETWORK,
      'STELLAR_NETWORK is required; refusing to default to a network (fail-closed).',
      correlationId,
    );
  }

  if (rawNetwork !== 'testnet' && rawNetwork !== 'mainnet') {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.INVALID_NETWORK,
      `STELLAR_NETWORK must be "testnet" or "mainnet" (received an unrecognized value).`,
      correlationId,
    );
  }

  const network = rawNetwork as StellarNetwork;
  const mainnetEnabled = isTruthy(env.STELLAR_MAINNET_ENABLED);

  if (network === 'mainnet' && !mainnetEnabled) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.MAINNET_NOT_ENABLED,
      'STELLAR_NETWORK=mainnet requires STELLAR_MAINNET_ENABLED=true (kill-switch).',
      correlationId,
    );
  }

  const defaults = STELLAR_NETWORK_DEFAULTS[network];
  const horizonUrl = env.STELLAR_HORIZON_URL?.trim() || defaults.horizonUrl;
  const rpcUrl = env.STELLAR_RPC_URL?.trim() || defaults.rpcUrl;
  const networkPassphrase =
    env.STELLAR_NETWORK_PASSPHRASE?.trim() || STELLAR_NETWORK_PASSPHRASES[network];

  if (!horizonUrl) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.MISSING_HORIZON_URL,
      'STELLAR_HORIZON_URL is required.',
      correlationId,
    );
  }
  if (!rpcUrl) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.MISSING_RPC_URL,
      'STELLAR_RPC_URL is required.',
      correlationId,
    );
  }
  if (!networkPassphrase) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.MISSING_PASSPHRASE,
      'STELLAR_NETWORK_PASSPHRASE is required.',
      correlationId,
    );
  }

  // Guard against address drift: a passphrase that does not match the selected
  // network would sign/verify against the wrong chain. Fail closed.
  if (networkPassphrase !== STELLAR_NETWORK_PASSPHRASES[network]) {
    throw new StellarConfigError(
      STELLAR_CONFIG_ERROR_CODES.PASSPHRASE_NETWORK_MISMATCH,
      `STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK=${network}.`,
      correlationId,
    );
  }

  return { network, horizonUrl, rpcUrl, networkPassphrase, mainnetEnabled };
}

/**
 * Ops-safe summary for logs/metrics. Never includes secrets or full config
 * dumps — only the network and whether mainnet is enabled.
 */
export function stellarConfigSummary(config: StellarConfig): {
  network: StellarNetwork;
  mainnetEnabled: boolean;
} {
  return { network: config.network, mainnetEnabled: config.mainnetEnabled };
}

export const stellarConfig = registerAs('stellar', () => resolveStellarConfig(process.env));
