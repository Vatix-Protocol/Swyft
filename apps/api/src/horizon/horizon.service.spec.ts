/**
 * #406 — HorizonService poller unit tests with Horizon mocked.
 *
 * `Horizon.Server` is replaced by a lightweight stub so no real network
 * request is ever made. BullMQ queues are stubbed to avoid Redis dependency.
 */

import { CacheService } from '../cache/cache.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
import { PoolsService } from '../pools/pools.service';
import { PriceService } from '../price/price.service';
import { PrismaService } from '../prisma/prisma.service';
import { HorizonService } from './horizon.service';

// ── Stub factories ────────────────────────────────────────────────────────────

function buildQueueMock() {
  return { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
}

function buildEffectsChain(records: object[]) {
  const call = jest.fn().mockResolvedValue({ records });
  return {
    effects: () => ({
      forAccount: () => ({
        cursor: () => ({ order: () => ({ limit: () => ({ call }) }) }),
      }),
    }),
    _call: call,
  };
}

function buildService(horizonServer: object) {
  const priceService = { broadcastPrice: jest.fn() } as unknown as PriceService;
  const poolsService = { handlePoolStateUpdate: jest.fn().mockResolvedValue(undefined) } as unknown as PoolsService;
  const cache = {
    publish: jest.fn().mockResolvedValue(undefined),
    setMaxNumber: jest.fn().mockResolvedValue(true),
  } as unknown as CacheService;
  const prisma = {
    indexerCursor: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const poolCreatedQueue = buildQueueMock();
  const swapProcessedQueue = buildQueueMock();
  const positionMintedQueue = buildQueueMock();
  const positionBurnedQueue = buildQueueMock();

  const service = new HorizonService(
    priceService,
    poolsService,
    cache,
    prisma,
    poolCreatedQueue as any,
    swapProcessedQueue as any,
    positionMintedQueue as any,
    positionBurnedQueue as any,
  );

  // Inject stubbed Horizon server (bypasses real network)
  (service as any).server = horizonServer;
  // Set contractId so the poller is active
  (service as any).contractId = 'GPOOL_CONTRACT';

  return { service, priceService, poolsService, cache, prisma, poolCreatedQueue, swapProcessedQueue, positionMintedQueue, positionBurnedQueue };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HorizonService — poller (Horizon mocked)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('ledger checkpoint', () => {
    it('advances the checkpoint after successfully processing an effect', async () => {
      const { server, _call } = buildEffectsChain([
        {
          paging_token: 'cursor-1',
          ledger: 900,
          amount: '1.25',
          created_at: '2026-06-24T12:00:00.000Z',
        },
      ]);
      const { service, poolsService, cache } = buildService(server);

      await (service as any).poll();

      expect(poolsService.handlePoolStateUpdate).toHaveBeenCalled();
      expect(cache.setMaxNumber).toHaveBeenCalledWith(
        LAST_INDEXED_LEDGER_KEY,
        900,
      );
    });

    it('does not write a checkpoint when the ledger is invalid (negative)', async () => {
      const { server } = buildEffectsChain([
        {
          paging_token: 'cursor-2',
          ledger: -1,
          created_at: '2026-06-24T12:00:00.000Z',
        },
      ]);
      const { service, cache } = buildService(server);

      await (service as any).poll();

      expect(cache.setMaxNumber).not.toHaveBeenCalled();
    });
  });

  describe('event enqueueing', () => {
    it('enqueues a pool_created job when the effect contains required fields', async () => {
      const { server } = buildEffectsChain([
        {
          paging_token: 'cursor-3',
          ledger: 901,
          created_at: '2026-06-24T12:00:00.000Z',
          eventType: 'pool_created',
          eventId: 'evt-pool-1',
          poolId: 'pool-abc',
          tokenA: 'TOKENA',
          tokenB: 'TOKENB',
          fee: '3000',
          sqrtPrice: '79228162514264337593543950336',
        },
      ]);
      const { service, poolCreatedQueue } = buildService(server);

      await (service as any).poll();

      expect(poolCreatedQueue.add).toHaveBeenCalledWith(
        'evt-pool-1',
        expect.objectContaining({ poolId: 'pool-abc', tokenA: 'TOKENA', tokenB: 'TOKENB' }),
        expect.any(Object),
      );
    });

    it('enqueues a swap_processed job when sender and recipient are present', async () => {
      const { server } = buildEffectsChain([
        {
          paging_token: 'cursor-4',
          ledger: 902,
          created_at: '2026-06-24T12:00:00.000Z',
          eventType: 'swap_processed',
          eventId: 'evt-swap-1',
          poolId: 'pool-abc',
          sender: 'GSENDER',
          recipient: 'GRECIPIENT',
          amount0: '1000',
          amount1: '500',
          sqrtPrice: '79228162514264337593543950336',
          liquidity: '1000000',
          tick: 42,
        },
      ]);
      const { service, swapProcessedQueue } = buildService(server);

      await (service as any).poll();

      expect(swapProcessedQueue.add).toHaveBeenCalledWith(
        'evt-swap-1',
        expect.objectContaining({ sender: 'GSENDER', recipient: 'GRECIPIENT' }),
        expect.any(Object),
      );
    });

    it('enqueues a position_minted job when owner and tokenId are present', async () => {
      const { server } = buildEffectsChain([
        {
          paging_token: 'cursor-5',
          ledger: 903,
          created_at: '2026-06-24T12:00:00.000Z',
          eventType: 'position_minted',
          eventId: 'evt-pos-1',
          poolId: 'pool-abc',
          owner: 'GOWNER',
          tokenId: 'nft-1',
          tickLower: -100,
          tickUpper: 100,
          liquidity: '500000',
          amount0: '250',
          amount1: '250',
        },
      ]);
      const { service, positionMintedQueue } = buildService(server);

      await (service as any).poll();

      expect(positionMintedQueue.add).toHaveBeenCalledWith(
        'evt-pos-1',
        expect.objectContaining({ owner: 'GOWNER', tokenId: 'nft-1' }),
        expect.any(Object),
      );
    });

    it('does not enqueue a pool_created job when tokenA or tokenB is missing', async () => {
      const { server } = buildEffectsChain([
        {
          paging_token: 'cursor-6',
          ledger: 904,
          created_at: '2026-06-24T12:00:00.000Z',
          eventType: 'pool_created',
          eventId: 'evt-pool-bad',
          poolId: 'pool-xyz',
          tokenA: '',
          tokenB: '',
          fee: '3000',
          sqrtPrice: '0',
        },
      ]);
      const { service, poolCreatedQueue } = buildService(server);

      await (service as any).poll();

      expect(poolCreatedQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('error resilience', () => {
    it('does not throw when Horizon.call() rejects — logs a warning instead', async () => {
      const server = {
        effects: () => ({
          forAccount: () => ({
            cursor: () => ({
              order: () => ({
                limit: () => ({
                  call: jest.fn().mockRejectedValue(new Error('network timeout')),
                }),
              }),
            }),
          }),
        }),
      };
      const { service } = buildService(server);

      // Should resolve without throwing
      await expect((service as any).poll()).resolves.toBeUndefined();
    });

    it('skips already-polling call (polling guard)', async () => {
      const call = jest.fn().mockResolvedValue({ records: [] });
      const server = {
        effects: () => ({
          forAccount: () => ({
            cursor: () => ({ order: () => ({ limit: () => ({ call }) }) }),
          }),
        }),
      };
      const { service } = buildService(server);

      // Set polling flag to simulate concurrent call
      (service as any).polling = true;

      await (service as any).poll();

      expect(call).not.toHaveBeenCalled();
    });
  });
});
