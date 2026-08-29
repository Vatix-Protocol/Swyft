/**
 * Centralised Stellar / Soroban network configuration.
 *
 * All RPC and Horizon URL values flow through this module so they are:
 *   • validated at startup (missing or malformed URLs cause a loud crash)
 *   • injectable via NestJS DI rather than scattered `process.env` reads
 *   • documented in one place
 *
 * Default URL values come from @swyft/config so there is a single source
 * of truth for testnet/mainnet endpoints across the monorepo.
 *
 * Required env vars (see apps/api/.env.example):
 *   STELLAR_RPC_URL   — Soroban JSON-RPC endpoint
 *   HORIZON_URL       — Horizon REST API endpoint
 *   STELLAR_NETWORK   — "testnet" | "mainnet"  (default: "testnet")
 *   POOL_CONTRACT_ID  — deployed single-pool contract address (legacy, optional)
 *   POOL_FACTORY_CONTRACT_ID — pool factory contract address; when set, the
 *                       Horizon indexer polls the factory account for
 *                       `pool_created` events and starts polling each pool
 *                       it discovers
 *
 * **Production boot behaviour (`NODE_ENV=production`):** STELLAR_RPC_URL and
 * HORIZON_URL must be set explicitly — the testnet defaults below are never
 * applied, so an indexer accidentally deployed without them fails fast at
 * boot instead of silently talking to testnet. Outside production (local
 * dev, CI, tests) the testnet defaults still apply for convenience.
 */

import { registerAs } from '@nestjs/config';
import {
  IsOptional,
  IsIn,
  validateSync,
  IsString,
  Matches,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NETWORK_PRESETS } from '@swyft/config';

// ── Allowed networks ─────────────────────────────────────────────────────────

export type StellarNetwork = 'testnet' | 'mainnet';

// Default URLs sourced from @swyft/config — single source of truth.
const TESTNET_DEFAULTS = {
  rpcUrl: NETWORK_PRESETS.TESTNET.rpcUrl,
  horizonUrl: NETWORK_PRESETS.TESTNET.horizonUrl,
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

  @IsOptional()
  @IsString()
  POOL_FACTORY_CONTRACT_ID?: string;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface StellarConfig {
  rpcUrl: string;
  horizonUrl: string;
  network: StellarNetwork;
  poolContractId: string;
  poolFactoryContractId: string;
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
export const stellarConfig = registerAs(
  STELLAR_CONFIG_KEY,
  (): StellarConfig => {
    const isProduction = process.env.NODE_ENV === 'production';

    // In production, require explicit URLs — never silently fall back to testnet.
    if (isProduction) {
      const missing: string[] = [];
      if (!process.env.STELLAR_RPC_URL) {
        missing.push('STELLAR_RPC_URL: must be set in production');
      }
      if (!process.env.HORIZON_URL) {
        missing.push('HORIZON_URL: must be set in production');
      }
      if (missing.length > 0) {
        throw new Error(
          `Stellar configuration is invalid:\n${missing.map((m) => `  ${m}`).join('\n')}`,
        );
      }
    }

    const env = plainToInstance(StellarEnvVars, {
      STELLAR_RPC_URL: process.env.STELLAR_RPC_URL ?? TESTNET_DEFAULTS.rpcUrl,
      HORIZON_URL: process.env.HORIZON_URL ?? TESTNET_DEFAULTS.horizonUrl,
      STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? 'testnet',
      POOL_CONTRACT_ID: process.env.POOL_CONTRACT_ID,
      POOL_FACTORY_CONTRACT_ID: process.env.POOL_FACTORY_CONTRACT_ID,
    });

    const errors = validateSync(env, { skipMissingProperties: false });

    if (errors.length > 0) {
      const details = errors
        .map(
          (e) =>
            `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
        )
        .join('\n');
      throw new Error(`Stellar configuration is invalid:\n${details}`);
    }

    return {
      rpcUrl: env.STELLAR_RPC_URL,
      horizonUrl: env.HORIZON_URL,
      network: env.STELLAR_NETWORK,
      poolContractId: env.POOL_CONTRACT_ID ?? '',
      poolFactoryContractId: env.POOL_FACTORY_CONTRACT_ID ?? '',
    };
  },
);
