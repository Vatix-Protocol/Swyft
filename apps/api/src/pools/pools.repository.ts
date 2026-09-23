import { Injectable } from '@nestjs/common';
import { Pool, ClPoolView } from './pool.types';

/**
 * Repository that owns the pool source of truth (SoT).
 *
 * Invariant (see CONTRACTS.md): the `pool` record is authoritative for
 * liquidity and state. Any `cl-pool` data is a *derived view* computed from
 * the pool SoT and MUST NOT be treated as an independent authority.
 */
@Injectable()
export class PoolsRepository {
  private readonly pools = new Map<string, Pool>();

  async findById(poolId: string): Promise<Pool | null> {
    return this.pools.get(poolId) ?? null;
  }

  async save(pool: Pool): Promise<Pool> {
    this.pools.set(pool.id, pool);
    return pool;
  }

  /**
   * Derive the cl-pool view from the authoritative pool record.
   *
   * This is the single SoT path for cl-pool data: callers must go through the
   * pool record rather than reading cl-pool state from a parallel source.
   */
  async findClPoolView(poolId: string): Promise<ClPoolView | null> {
    const pool = await this.findById(poolId);
    if (!pool) {
      return null;
    }
    return this.deriveClPoolView(pool);
  }

  private deriveClPoolView(pool: Pool): ClPoolView {
    return {
      poolId: pool.id,
      // cl-pool fields are derived from the pool SoT; no parallel authority.
      liquidity: pool.liquidity,
      tickSpacing: pool.tickSpacing,
      currentTick: pool.currentTick,
      sqrtPriceX96: pool.sqrtPriceX96,
      derivedFromPool: true,
    };
  }
}
