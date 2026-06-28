import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import { SwapsController } from './swaps.controller';

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

describe('Swaps E2E (mocked RPC)', () => {
  let app: INestApplication;
  let mockRepo: jest.Mocked<SwapsRepository>;

  beforeEach(async () => {
    mockRepo = {
      listSwaps: jest.fn(),
    } as unknown as jest.Mocked<SwapsRepository>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SwapsController],
      providers: [
        SwapsService,
        { provide: SwapsRepository, useValue: mockRepo },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
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

      const res = await request(app.getHttpServer())
        .get('/swaps')
        .expect(200);

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
});
