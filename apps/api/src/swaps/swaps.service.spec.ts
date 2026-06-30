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
});
