import {
  filterActivePools,
  isPoolActive,
  PoolActivityFields,
} from './inactive-pool.filter';

describe('inactive-pool.filter', () => {
  describe('isPoolActive', () => {
    it('is true for a pool flagged active with positive TVL', () => {
      expect(isPoolActive({ isActive: true, tvl: '100' })).toBe(true);
    });

    it('is false for a pool flagged inactive, regardless of TVL', () => {
      expect(isPoolActive({ isActive: false, tvl: '100' })).toBe(false);
    });

    it('treats a missing/null flag as active when other criteria pass', () => {
      expect(isPoolActive({ tvl: 5 })).toBe(true);
      expect(isPoolActive({ isActive: null, tvl: 5 })).toBe(true);
    });

    it('is false for an archived pool even when flagged active', () => {
      expect(
        isPoolActive({
          isActive: true,
          archivedAt: new Date('2026-01-01T00:00:00.000Z'),
          tvl: '100',
        }),
      ).toBe(false);
      expect(
        isPoolActive({ isActive: true, archivedAt: '2026-01-01', tvl: '100' }),
      ).toBe(false);
    });

    it('is false for a pool with zero or non-numeric TVL', () => {
      expect(isPoolActive({ isActive: true, tvl: '0' })).toBe(false);
      expect(isPoolActive({ isActive: true, tvl: 0 })).toBe(false);
      expect(isPoolActive({ isActive: true, tvl: 'NaN' })).toBe(false);
    });
  });

  describe('filterActivePools', () => {
    const pools: (PoolActivityFields & { id: string })[] = [
      { id: 'active', isActive: true, tvl: '100' },
      { id: 'inactive', isActive: false, tvl: '100' },
      { id: 'archived', isActive: true, archivedAt: '2026-01-01', tvl: '100' },
      { id: 'empty', isActive: true, tvl: '0' },
    ];

    it('keeps only active pools and preserves the item shape', () => {
      expect(filterActivePools(pools)).toEqual([
        { id: 'active', isActive: true, tvl: '100' },
      ]);
    });

    it('returns an empty list when every pool is inactive', () => {
      expect(filterActivePools(pools.slice(1))).toEqual([]);
    });
  });
});
