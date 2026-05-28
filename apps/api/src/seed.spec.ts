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
    .mockResolvedValueOnce({ symbol: 'USDC', address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }) // token0
    .mockResolvedValueOnce({ symbol: 'XLM',  address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR' }) // token1
    .mockResolvedValueOnce({ id: 'test-pool-1' })     // pool
    .mockResolvedValueOnce({ id: 'test-position-1' }); // position
  mockCreateMany.mockResolvedValue({ count: 2 });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('prisma seed', () => {
  async function runSeed() {
    // Re-require each time so module-level code (main()) runs fresh
    jest.resetModules();

    // Re-apply mock after resetModules
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

    // Dynamically import so the top-level main() call executes
    await import('../../../../prisma/seed');
    // Allow all pending promises to settle
    await new Promise((r) => setImmediate(r));
  }

  it('upserts USDC token with correct address', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
        create: expect.objectContaining({ symbol: 'USDC', decimals: 6 }),
      }),
    );
  });

  it('upserts XLM token with correct address', async () => {
    await runSeed();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR' },
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
        data: expect.arrayContaining([
          expect.objectContaining({ poolId: 'test-pool-1', interval: '1h' }),
        ]),
      }),
    );
  });

  it('disconnects prisma after seeding', async () => {
    await runSeed();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
