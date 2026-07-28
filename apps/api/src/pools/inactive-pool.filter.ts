export interface PoolActivityFields {
  isActive?: boolean | null;
  archivedAt?: Date | string | null;
  tvl: string | number;
}

/**
 * Default pool list policy: a pool is considered inactive/archived (and
 * hidden from the default list) if it has been explicitly marked inactive,
 * has an archivedAt timestamp set, or holds zero TVL. Callers that want to
 * include archived pools (e.g. an "include archived" filter toggle) should
 * bypass this helper and query unfiltered instead.
 */
export function isPoolActive(pool: PoolActivityFields): boolean {
  if (pool.isActive === false) {
    return false;
  }
  if (pool.archivedAt) {
    return false;
  }
  return Number(pool.tvl) > 0;
}

export function filterActivePools<T extends PoolActivityFields>(
  pools: T[],
): T[] {
  return pools.filter(isPoolActive);
}
