/**
 * Centralised Stellar / Soroban network configuration.
 *
 * All RPC and Horizon URL values flow through this module so they are:
 *   • validated at startup (missing or malformed URLs cause a loud crash)
 *   • injectable via NestJS DI rather than scattered `process.env` reads
 *   • documented in one place
 *
 * Required env vars (see apps/api/.env.example):
 *   STELLAR_RPC_URL   — Soroban JSON-RPC endpoint
 *   HORIZON_URL       — Horizon REST API endpoint
 *   STELLAR_NETWORK   — "testnet" | "mainnet"  (default: "testnet")
 *   POOL_CONTRACT_ID  — deployed pool contract address (optional on testnet)
 */

import { registerAs } from '@nestjs/config';
import { IsOptional, IsIn, validateSync, IsString, Matches } from 'class-validator';
import { plainToInstance } from 'class-transformer';

// ── Allowed networks ─────────────────────────────────────────────────────────

export type StellarNetwork = 'testnet' | 'mainnet';

const TESTNET_DEFAULTS = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
} as const;

// Accepts http:// and https:// only — rejects ftp, ws, etc.
const HTTP_URL_PATTERN = /^https?:\/\/.+/;

// ── Validation class ─────────────────────────────────────────────────────────

class StellarEnvVars {
  @Matches(HTTP_URL_PATTERN, {
    message: 'STELLAR_RPC_URL must be a valid http:// or https:// URL',
  })
  STELLAR_RPC_URL: string = TESTNET_DEFAULTS.rpcUrl;

  @Matches(HTTP_URL_PATTERN, {
    message: 'HORIZON_URL must be a valid http:// or https:// URL',
  })
  HORIZON_URL: string = TESTNET_DEFAULTS.horizonUrl;

  @IsIn(['testnet', 'mainnet'])
  STELLAR_NETWORK: StellarNetwork = 'testnet';

  @IsOptional()
  @IsString()
  POOL_CONTRACT_ID?: string;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface StellarConfig {
  rpcUrl: string;
  horizonUrl: string;
  network: StellarNetwork;
  poolContractId: string;
}

export const STELLAR_CONFIG_KEY = 'stellar';

/**
 * Validates and exposes Stellar-related env vars via `@nestjs/config`.
 *
 * Usage:
 * ```ts
 * const cfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
 * ```
 */
export const stellarConfig = registerAs(STELLAR_CONFIG_KEY, (): StellarConfig => {
  const env = plainToInstance(StellarEnvVars, {
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL ?? TESTNET_DEFAULTS.rpcUrl,
    HORIZON_URL: process.env.HORIZON_URL ?? TESTNET_DEFAULTS.horizonUrl,
    STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? 'testnet',
    POOL_CONTRACT_ID: process.env.POOL_CONTRACT_ID,
  });

  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Stellar configuration is invalid:\n${details}`);
  }

  return {
    rpcUrl: env.STELLAR_RPC_URL,
    horizonUrl: env.HORIZON_URL,
    network: env.STELLAR_NETWORK,
    poolContractId: env.POOL_CONTRACT_ID ?? '',
  };
});
