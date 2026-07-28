import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import { SwapsController } from './swaps.controller';
import { PoolsService } from '../pools/pools.service';

const mockSwap = {
  id: 'swap-e2e-1',
  poolId: 'pool-e2e-1',
  token0Symbol: 'XLM',
  token1Symbol: 'USDC',
  amount0: '1000000',
  amount1: '-500000',
  priceAtSwap: '0.5',
  feeAmount: '300',
  txHash: 'txhash-e2e-1',
  walletAddress: '0xSender',
  timestamp: 1700000000000,
};

const mockPoolDetail = {
  id: 'pool-e2e-1',
  token0: {
    address: '0xTokenA',
    symbol: 'XLM',
    name: 'Stellar Lumens',
    decimals: 7,
  },
  token1: {
    address: '0xTokenB',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  feeTier: 3000,
  currentSqrtPrice: '79228162514264337593543950336', // price = 1
  currentTick: 0,
  totalLiquidity: '1000000000000000000',
  tvl: '5000000',
  volume24h: '1200000',
  volume7d: '0',
  feeApr: '0.15',
  creationTimestamp: 1700000000,
  recentSwaps: [],
};

describe('Swaps E2E (mocked RPC)', () => {
  let app: INestApplication;
  let mockRepo: jest.Mocked<SwapsRepository>;
  let mockPools: { findPoolById: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      listSwaps: jest.fn(),
    } as unknown as jest.Mocked<SwapsRepository>;
    mockPools = { findPoolById: jest.fn().mockResolvedValue(mockPoolDetail) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SwapsController],
      providers: [
        SwapsService,
        { provide: SwapsRepository, useValue: mockRepo },
        { provide: PoolsService, useValue: mockPools },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('GET /swaps', () => {
    it('returns paginated swap list', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 1 });

      const res = await request(app.getHttpServer())
        .get('/swaps')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.totalPages).toBe(1);
      expect(res.body.items[0].poolId).toBe('pool-e2e-1');
    });

    it('returns empty list when no swaps exist', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [], total: 0 });

      const res = await request(app.getHttpServer()).get('/swaps').expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.totalPages).toBe(0);
    });

    it('filters swaps by pool id', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 1 });

      const res = await request(app.getHttpServer())
        .get('/swaps')
        .query({ pool: 'pool-e2e-1' })
        .expect(200);

      expect(mockRepo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ pool: 'pool-e2e-1' }),
      );
      expect(res.body.items[0].poolId).toBe('pool-e2e-1');
    });

    it('filters swaps by wallet address', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 1 });

      await request(app.getHttpServer())
        .get('/swaps')
        .query({ wallet: '0xSender' })
        .expect(200);

      expect(mockRepo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: '0xSender' }),
      );
    });

    it('applies default pagination when no page/limit supplied', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [], total: 0 });

      await request(app.getHttpServer()).get('/swaps').expect(200);

      expect(mockRepo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });

    it('maps feeAmount from repository to response', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 1 });

      const res = await request(app.getHttpServer()).get('/swaps').expect(200);

      expect(res.body.items[0].feeAmount).toBe('300');
    });

    it('maps transactionHash from repository txHash', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 1 });

      const res = await request(app.getHttpServer()).get('/swaps').expect(200);

      expect(res.body.items[0].transactionHash).toBe('txhash-e2e-1');
    });

    it('returns 500 when repository throws an unexpected error', async () => {
      mockRepo.listSwaps.mockRejectedValue(new Error('DB unavailable'));

      await request(app.getHttpServer()).get('/swaps').expect(500);
    });

    it('correctly computes totalPages for multi-page result', async () => {
      mockRepo.listSwaps.mockResolvedValue({ items: [mockSwap], total: 25 });

      const res = await request(app.getHttpServer())
        .get('/swaps')
        .query({ limit: 10 })
        .expect(200);

      expect(res.body.totalPages).toBe(3);
    });
  });

  describe('POST /swaps/quote', () => {
    it('returns a quote estimate for a known pool', async () => {
      const res = await request(app.getHttpServer())
        .post('/swaps/quote')
        .send({
          poolId: 'pool-e2e-1',
          tokenIn: '0xTokenA',
          tokenOut: '0xTokenB',
          amountIn: '100',
          slippageBps: 50,
        })
        .expect(201);

      expect(res.body).toEqual({
        amountOut: '99.7000000',
        priceImpact: 0,
        lpFee: '0.3000000',
        minimumReceived: '99.2015000',
        executionPrice: '0.9970000',
      });
    });

    it('returns 404 for an unknown pool', async () => {
      mockPools.findPoolById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/swaps/quote')
        .send({
          poolId: 'unknown-pool',
          tokenIn: '0xTokenA',
          tokenOut: '0xTokenB',
          amountIn: '100',
          slippageBps: 50,
        })
        .expect(404);
    });

    it('returns 400 for a malformed amountIn', async () => {
      await request(app.getHttpServer())
        .post('/swaps/quote')
        .send({
          poolId: 'pool-e2e-1',
          tokenIn: '0xTokenA',
          tokenOut: '0xTokenB',
          amountIn: 'not-a-number',
          slippageBps: 50,
        })
        .expect(400);
    });
  });
});
