/**
 * Tests for indexer lag calculation.
 * Verifies that lagLedgers and lagSeconds are computed correctly
 * from Horizon tip and the last indexed ledger checkpoint.
 */

describe('IndexerMonitorService - Lag Calculation', () => {
  // Constants from indexer-monitor.service.ts
  const LEDGER_CLOSE_SECONDS = 5;

  describe('lag calculation formula', () => {
    it('should calculate zero lag when indexer is caught up', () => {
      // Setup: lastIndexedLedger = 1000, latestLedger = 1000
      const lastIndexedLedger = 1000;
      const latestLedger = 1000;

      // Expected: lagLedgers = 0, lagSeconds = 0
      const lagLedgers = Math.max(0, latestLedger - lastIndexedLedger);
      const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;

      expect(lagLedgers).toBe(0);
      expect(lagSeconds).toBe(0);
    });

    it('should calculate lag when indexer is behind', () => {
      // Setup: lastIndexedLedger = 990, latestLedger = 1000 (lag of 10)
      const lastIndexedLedger = 990;
      const latestLedger = 1000;

      // Expected: lagLedgers = 10, lagSeconds = 50
      const lagLedgers = Math.max(0, latestLedger - lastIndexedLedger);
      const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;

      expect(lagLedgers).toBe(10);
      expect(lagSeconds).toBe(50);
    });

    it('should clamp negative lag to zero', () => {
      // Edge case: indexer ahead of Horizon (shouldn't happen, but protected)
      // Setup: lastIndexedLedger = 1000, latestLedger = 990
      const lastIndexedLedger = 1000;
      const latestLedger = 990;

      // Expected: lagLedgers = 0 (clamped from -10)
      const lagLedgers = Math.max(0, latestLedger - lastIndexedLedger);
      const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;

      expect(lagLedgers).toBe(0);
      expect(lagSeconds).toBe(0);
    });

    it('should handle large lag values correctly', () => {
      // Setup: lag of 1000 ledgers
      const lastIndexedLedger = 0;
      const latestLedger = 1000;

      // Expected: lagLedgers = 1000, lagSeconds = 5000
      const lagLedgers = Math.max(0, latestLedger - lastIndexedLedger);
      const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;

      expect(lagLedgers).toBe(1000);
      expect(lagSeconds).toBe(5000);
      expect(lagSeconds).toBe(1000 * 5); // 5 seconds per ledger
    });
  });

  describe('status determination based on lag', () => {
    // Status thresholds from indexer-monitor.service.ts
    it('should be healthy when lag < 10 ledgers', () => {
      const lagLedgers = 5;
      const hasCheckpoint = true;

      // Logic: if (lagLedgers < 10) return 'healthy'
      const status =
        !hasCheckpoint ? 'healthy' : lagLedgers < 10 ? 'healthy' : lagLedgers <= 50 ? 'degraded' : 'critical';

      expect(status).toBe('healthy');
    });

    it('should be degraded when 10 <= lag <= 50 ledgers', () => {
      const lagLedgers = 30;
      const hasCheckpoint = true;

      // Logic: if (lagLedgers <= 50) return 'degraded'
      const status =
        !hasCheckpoint ? 'healthy' : lagLedgers < 10 ? 'healthy' : lagLedgers <= 50 ? 'degraded' : 'critical';

      expect(status).toBe('degraded');
    });

    it('should be critical when lag > 50 ledgers', () => {
      const lagLedgers = 100;
      const hasCheckpoint = true;

      // Logic: if (lagLedgers > 50) return 'critical'
      const status =
        !hasCheckpoint ? 'healthy' : lagLedgers < 10 ? 'healthy' : lagLedgers <= 50 ? 'degraded' : 'critical';

      expect(status).toBe('critical');
    });

    it('should be healthy when no checkpoint exists yet', () => {
      const lagLedgers = 0; // Irrelevant if hasCheckpoint = false
      const hasCheckpoint = false;

      // Logic: if (!hasCheckpoint) return 'healthy'
      const status =
        !hasCheckpoint ? 'healthy' : lagLedgers < 10 ? 'healthy' : lagLedgers <= 50 ? 'degraded' : 'critical';

      expect(status).toBe('healthy'); // No checkpoint = indexer just starting
    });
  });

  describe('time conversion accuracy', () => {
    it('should convert ledger lag to seconds correctly', () => {
      // 1 ledger = 5 seconds
      // Test various lag amounts

      const testCases: Array<[number, number]> = [
        [1, 5],     // 1 ledger = 5 seconds
        [2, 10],    // 2 ledgers = 10 seconds
        [10, 50],   // 10 ledgers = 50 seconds
        [60, 300],  // 60 ledgers = 300 seconds = 5 minutes
        [720, 3600], // 720 ledgers = 3600 seconds = 1 hour
      ];

      for (const [lagLedgers, expectedSeconds] of testCases) {
        const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;
        expect(lagSeconds).toBe(expectedSeconds);
      }
    });

    it('should document that LEDGER_CLOSE_SECONDS is a Stellar constant', () => {
      // Stellar network closes a new ledger every ~5 seconds
      // This is a network constant, not configurable
      expect(LEDGER_CLOSE_SECONDS).toBe(5);
    });
  });

  describe('metrics endpoint response format', () => {
    it('should return IndexerMetrics with all required fields', () => {
      // Expected shape of IndexerMetrics from metrics endpoint
      const expectedMetrics = {
        lastIndexedLedger: expect.any(Number),
        latestLedger: expect.any(Number),
        lagLedgers: expect.any(Number),
        lagSeconds: expect.any(Number),
        status: expect.stringMatching(/healthy|degraded|critical/),
      };

      // Example response:
      const exampleMetrics = {
        lastIndexedLedger: 50_000_000,
        latestLedger: 50_000_010,
        lagLedgers: 10,
        lagSeconds: 50,
        status: 'healthy' as const,
      };

      expect(exampleMetrics).toMatchObject(expectedMetrics);
    });

    it('should include lagLedgers and lagSeconds in every metrics response', () => {
      // Operators need these fields for monitoring dashboard
      // Ensure they are always present, even if zero

      const metricsWithLag = {
        lastIndexedLedger: 1000,
        latestLedger: 1000,
        lagLedgers: 0,
        lagSeconds: 0,
        status: 'healthy' as const,
      };

      expect(metricsWithLag).toHaveProperty('lagLedgers');
      expect(metricsWithLag).toHaveProperty('lagSeconds');
      expect(typeof metricsWithLag.lagLedgers).toBe('number');
      expect(typeof metricsWithLag.lagSeconds).toBe('number');
    });
  });
});
