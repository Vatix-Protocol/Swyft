/**
 * Unit tests for prisma/seed.ts
 *
 * All Prisma client calls are mocked so no real database connection is needed.
 * The tests verify that each entity (tokens, pool, position, swaps, candles)
 * is upserted / created with the expected arguments.
 */

import { PrismaClient } from '@prisma/client';

// ── Mock PrismaClient ────────────────────────────────────────────────────────

const mockUpsert = jest.fn();
const mockCreateMany = jest.fn();
const mockDisconnect = jest.fn().mockResolvedValue(undefined);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    token: { upsert: mockUpsert },
    pool: { upsert: mockUpsert },
    position: { upsert: mockUpsert },
    swap: { createMany: mockCreateMany },
    priceCandle: { createMany: mockCreateMany },
    $disconnect: mockDisconnect,
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Suppress spinner stdout noise during tests. */
beforeAll(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  (process.stdout.write as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: upsert returns the created record
  mockUpsert
    .mockResolvedValueOnce({
      symbol: 'USDC',
      address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    }) // token0
    .mockResolvedValueOnce({
      symbol: 'XLM',
      address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
    }) // token1
    .mockResolvedValueOnce({ id: 'test-pool-1' }) // pool
    .mockResolvedValueOnce({ id: 'test-position-1' }); // position
  mockCreateMany.mockResolvedValue({ count: 2 });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('prisma seed', () => {
  async function runSeed() {
    // Re-require each time so the seed module re-executes with a fresh PrismaClient
    jest.resetModules();

    // Re-apply mock after resetModules so the freshly-imported module gets the mock
    jest.mock('@prisma/client', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        token: { upsert: mockUpsert },
        pool: { upsert: mockUpsert },
        position: { upsert: mockUpsert },
        swap: { createMany: mockCreateMany },
        priceCandle: { createMany: mockCreateMany },
        $disconnect: mockDisconnect,
      })),
    }));

    // Import the module and explicitly call main() — the require.main === module
    // guard in seed.ts prevents main() from auto-running during import in tests.
    const { main } = await import('../../../prisma/seed');
    await main();
  }

  it('upserts USDC token with correct address', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        },
        create: expect.objectContaining({ symbol: 'USDC', decimals: 6 }),
      }),
    );
  });

  it('upserts XLM token with correct address', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
        },
        create: expect.objectContaining({ symbol: 'XLM', decimals: 7 }),
      }),
    );
  });

  it('upserts pool with fee tier 3000', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-pool-1' },
        create: expect.objectContaining({ feeTier: 3000 }),
      }),
    );
  });

  it('upserts position linked to the pool', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-position-1' },
        create: expect.objectContaining({ poolId: 'test-pool-1' }),
      }),
    );
  });

  it('creates 2 swap records', async () => {
    await runSeed();
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'test-tx-1' }),
          expect.objectContaining({ transactionHash: 'test-tx-2' }),
        ]),
      }),
    );
  });

  it('creates at least 1 price candle', async () => {
    await runSeed();
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            poolId: 'test-pool-1',
            interval: '1h',
            periodStart: new Date('2026-01-01T00:00:00.000Z'),
          }),
        ]),
      }),
    );
  });

  it('disconnects prisma after seeding', async () => {
    await runSeed();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('pins swap timestamps from the fixture instead of DB now() defaults', async () => {
    await runSeed();
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            eventId: 'seed-swap-event-1',
            timestamp: new Date('2026-01-01T00:05:00.000Z'),
          }),
        ]),
      }),
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-pool-1' },
        create: expect.objectContaining({
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('produces identical writes on repeated runs (deterministic)', async () => {
    await runSeed();
    const first = JSON.stringify([
      mockUpsert.mock.calls,
      mockCreateMany.mock.calls,
    ]);
    mockUpsert.mockClear();
    mockCreateMany.mockClear();
    mockUpsert
      .mockResolvedValueOnce({ symbol: 'USDC' })
      .mockResolvedValueOnce({ symbol: 'XLM' })
      .mockResolvedValueOnce({ id: 'test-pool-1' })
      .mockResolvedValueOnce({ id: 'test-position-1' });
    await runSeed();
    expect(
      JSON.stringify([mockUpsert.mock.calls, mockCreateMany.mock.calls]),
    ).toBe(first);
  });

  describe('fail-closed guard', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it.each([
      ['NODE_ENV', 'production'],
      ['STELLAR_NETWORK', 'mainnet'],
      ['STELLAR_NETWORK', 'PUBLIC'],
    ])('refuses to seed when %s=%s and writes nothing', async (key, value) => {
      process.env[key] = value;
      await expect(runSeed()).rejects.toThrow(/SEED_REFUSED/);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockCreateMany).not.toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });
});
