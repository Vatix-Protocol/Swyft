import { Test, TestingModule } from '@nestjs/testing';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import { SwapErrorCode, SwapSnapshot } from './swap.types';
import { SlippageExceededException } from '../request-validation/http.exceptions';

const makeSnapshot = (overrides: Partial<SwapSnapshot> = {}): SwapSnapshot => ({
  id: 'swap-1',
  poolId: 'pool-1',
  token0Symbol: 'USDC',
  token1Symbol: 'XLM',
  amount0: '100',
  amount1: '-50',
  priceAtSwap: '2',
  feeAmount: '0.3',
  txHash: 'tx-1',
  walletAddress: 'wallet-1',
  timestamp: 1_700_000_000_000,
  ...overrides,
});

describe('SwapsService', () => {
  let service: SwapsService;
  let repo: jest.Mocked<SwapsRepository>;

  beforeEach(async () => {
    repo = { listSwaps: jest.fn() } as unknown as jest.Mocked<SwapsRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [SwapsService, { provide: SwapsRepository, useValue: repo }],
    }).compile();

    service = module.get<SwapsService>(SwapsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSwaps()', () => {
    it('returns paginated swap list', async () => {
      repo.listSwaps.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('passes poolId filter to repository', async () => {
      repo.listSwaps.mockResolvedValue({ items: [], total: 0 });

      await service.getSwaps({ poolId: 'pool-abc', page: 1, limit: 10 });

      expect(repo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: 'pool-abc' }),
      );
    });

    it('includes normalized tokenPair field in each response item', async () => {
      repo.listSwaps.mockResolvedValue({
        items: [makeSnapshot({ token0Symbol: 'USDC', token1Symbol: 'XLM' })],
        total: 1,
      });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result.items[0].tokenPair).toBe('USDC/XLM');
      expect(result.items[0].token0Symbol).toBe('USDC');
      expect(result.items[0].token1Symbol).toBe('XLM');
    });

    it('computes correct totalPages', async () => {
      repo.listSwaps.mockResolvedValue({ items: [], total: 35 });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result.totalPages).toBe(4);
    });

    it('throws SlippageExceededException when repository rejects with SLIPPAGE_EXCEEDED', async () => {
      repo.listSwaps.mockRejectedValue(
        new Error(SwapErrorCode.SLIPPAGE_EXCEEDED),
      );

      await expect(service.getSwaps({ page: 1, limit: 10 })).rejects.toThrow(
        SlippageExceededException,
      );
    });

    it('re-throws non-slippage errors unchanged', async () => {
      const err = new Error('some other error');
      repo.listSwaps.mockRejectedValue(err);

      await expect(service.getSwaps({ page: 1, limit: 10 })).rejects.toThrow(
        'some other error',
      );
    });
  });

  describe('snapshot', () => {
    it('matches snapshot for swap processed response', async () => {
      repo.listSwaps.mockResolvedValue({
        items: [
          makeSnapshot({
            id: 'swap-test-1',
            poolId: 'pool-test-1',
            token0Symbol: 'USDC',
            token1Symbol: 'XLM',
            amount0: '150.50',
            amount1: '-75.25',
            priceAtSwap: '2.0015',
            feeAmount: '0.4515',
            txHash: 'tx-hash-test-123',
            walletAddress: 'wallet-test-address-abc',
            timestamp: 1_700_123_456_789,
          }),
          makeSnapshot({
            id: 'swap-test-2',
            poolId: 'pool-test-2',
            token0Symbol: 'ETH',
            token1Symbol: 'USDT',
            amount0: '1.5',
            amount1: '-3000.75',
            priceAtSwap: '2000.50',
            feeAmount: '4.50',
            txHash: 'tx-hash-test-456',
            walletAddress: 'wallet-test-address-def',
            timestamp: 1_700_123_456_790,
          }),
        ],
        total: 2,
      });

      const result = await service.getSwaps({ page: 1, limit: 20 });

      // Remove timestamp-sensitive fields for stable snapshot
      const sanitizedResult = {
        ...result,
        items: result.items.map(item => ({
          ...item,
          // Remove any dynamic fields that might change
          id: expect.any(String),
          timestamp: expect.any(Number),
        })),
      };

      expect(sanitizedResult).toMatchSnapshot();
    });

    it('matches snapshot for empty swap list', async () => {
      repo.listSwaps.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result).toMatchSnapshot();
    });

    it('matches snapshot for pagination metadata', async () => {
      repo.listSwaps.mockResolvedValue({
        items: Array.from({ length: 5 }, (_, i) => 
          makeSnapshot({
            id: `swap-paginated-${i}`,
            poolId: `pool-paginated-${i}`,
            token0Symbol: 'USDC',
            token1Symbol: 'XLM',
            amount0: `${100 + i}`,
            amount1: `${-50 - i}`,
            priceAtSwap: `${2 + i * 0.1}`,
            feeAmount: `${0.3 + i * 0.1}`,
            txHash: `tx-paginated-${i}`,
            walletAddress: `wallet-paginated-${i}`,
            timestamp: 1_700_000_000_000 + i,
          })
        ),
        total: 35,
      });

      const result = await service.getSwaps({ page: 2, limit: 5 });

      // Test structure without dynamic values
      expect(result).toEqual({
        items: expect.any(Array),
        page: 2,
        limit: 5,
        total: 35,
        totalPages: 7,
        isLoading: false,
      });
      
      // Verify item structure matches expected shape
      result.items.forEach(item => {
        expect(item).toEqual({
          id: expect.any(String),
          poolId: expect.any(String),
          tokenPair: 'USDC/XLM',
          token0Symbol: 'USDC',
          token1Symbol: 'XLM',
          amount0: expect.any(String),
          amount1: expect.any(String),
          priceAtSwap: expect.any(String),
          feeAmount: expect.any(String),
          transactionHash: expect.any(String),
          walletAddress: expect.any(String),
          timestamp: expect.any(Number),
        });
      });
    });
  });
});
