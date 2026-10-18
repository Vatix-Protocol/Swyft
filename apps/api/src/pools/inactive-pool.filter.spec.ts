import {
  filterActivePools,
  isPoolActive,
  PoolActivityFields,
} from './inactive-pool.filter';
import { mockPool } from '../pools-unit-test/mock-factories';

/** Build a PoolActivityFields fixture backed by the shared mock factory. */
function pool(overrides: Partial<PoolActivityFields> = {}): PoolActivityFields {
  return {
    ...mockPool({ tvl: '5000000' }),
    ...overrides,
  } as PoolActivityFields;
}

describe('inactive-pool filter', () => {
  describe('isPoolActive', () => {
    it('treats a pool with positive TVL and no inactive markers as active', () => {
      expect(isPoolActive(pool({}))).toBe(true);
    });

    it('treats an explicitly deactivated pool as inactive', () => {
      expect(isPoolActive(pool({ isActive: false }))).toBe(false);
    });

    it('treats an archived pool as inactive', () => {
      expect(
        isPoolActive(pool({ archivedAt: new Date('2026-01-01T00:00:00Z') })),
      ).toBe(false);
    });

    it('treats a zero-TVL pool as inactive', () => {
      expect(isPoolActive(pool({ tvl: '0' }))).toBe(false);
    });
  });

  describe('filterActivePools', () => {
    it('returns only active pools when inactive pools are not requested', () => {
      const pools = [
        pool({ id: 'active-1', tvl: '1000' }),
        pool({ id: 'inactive-flag', isActive: false, tvl: '1000' }),
        pool({ id: 'inactive-archived', archivedAt: new Date(), tvl: '1000' }),
        pool({ id: 'inactive-zero-tvl', tvl: '0' }),
      ];

      const result = filterActivePools(pools);

      expect(result.map((p) => p.id).sort()).toEqual(['active-1']);
      expect(result.every(isPoolActive)).toBe(true);
    });

    it('keeps every active pool and drops every inactive pool', () => {
      const pools = [
        pool({ id: 'active-a', tvl: '10' }),
        pool({ id: 'active-b', tvl: '20' }),
        pool({ id: 'inactive-a', isActive: false, tvl: '30' }),
        pool({ id: 'inactive-b', archivedAt: new Date(), tvl: '30' }),
      ];

      const result = filterActivePools(pools);

      expect(result.map((p) => p.id).sort()).toEqual(['active-a', 'active-b']);
    });
  });
});
