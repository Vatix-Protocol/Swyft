import { Pool, Token } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import { SwapErrorCode, SwapSnapshot } from './swap.types';
import { PoolDetail, PoolsService } from '../pools/pools.service';
import {
  BusinessRuleViolationException,
  InvalidInputException,
  ResourceNotFoundException,
  SlippageExceededException,
} from '../request-validation/http.exceptions';

const makePoolDetail = (overrides: Partial<PoolDetail> = {}): PoolDetail => ({
  id: 'pool-1',
  token0: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  token1: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  feeTier: 3000,
  // Encodes a human price (token1 per token0) of 1, accounting for the
  // 6 vs 18 decimals difference between token0 and token1 below.
  currentSqrtPrice: '79228162514264337593543950336000000', // price = 1
  currentTick: 0,
  totalLiquidity: '5000000000000000000000000',
  tvl: '5000000',
  volume24h: '1200000',
  volume7d: '0',
  feeApr: '0.15',
  creationTimestamp: 1_700_000_000,
  recentSwaps: [],
  ...overrides,
});

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

const makeToken = (overrides: Partial<Token> = {}): Token => ({
  id: 'tok-1',
  address: 'USDC-addr',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUri: null,
  ...overrides,
});

describe('SwapsService', () => {
  let service: SwapsService;
  let repo: jest.Mocked<SwapsRepository>;
  let pools: { findPoolById: jest.Mock; getPoolTicks: jest.Mock };

  beforeEach(async () => {
    repo = { listSwaps: jest.fn() } as unknown as jest.Mocked<SwapsRepository>;
    pools = {
      findPoolById: jest.fn(),
      getPoolTicks: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapsService,
        { provide: SwapsRepository, useValue: repo },
        { provide: PoolsService, useValue: pools },
      ],
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

  describe('getQuote()', () => {
    const baseRequest = {
      poolId: 'pool-1',
      tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amountIn: '100',
      slippageBps: 50,
    };

    it('quotes token0 -> token1 by walking the tick ladder from the pool price and fee tier', async () => {
      pools.findPoolById.mockResolvedValue(makePoolDetail());

      const result = await service.getQuote(baseRequest);

      expect(result).toEqual({
        amountOut: '99.699999998011982',
        priceImpact: 0,
        lpFee: '0.3',
        minimumReceived: '99.20149999802192209',
        executionPrice: '0.9970000',
      });
    });

    it('quotes token1 -> token0 using the inverse price', async () => {
      // sqrtPrice encodes price (token1 per token0) = 4
      pools.findPoolById.mockResolvedValue(
        makePoolDetail({
          currentSqrtPrice: '158456325028528675187087900672000000',
        }),
      );

      const result = await service.getQuote({
        ...baseRequest,
        tokenIn: baseRequest.tokenOut,
        tokenOut: baseRequest.tokenIn,
      });

      // amountInAfterFee (99.7) / price (4)
      expect(result.amountOut).toBe('24.924999');
    });

    it('throws ResourceNotFoundException for an unknown pool', async () => {
      pools.findPoolById.mockResolvedValue(null);

      await expect(service.getQuote(baseRequest)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('throws InvalidInputException when tokenIn/tokenOut do not match the pool', async () => {
      pools.findPoolById.mockResolvedValue(makePoolDetail());

      await expect(
        service.getQuote({ ...baseRequest, tokenOut: '0xSomeOtherToken' }),
      ).rejects.toThrow(InvalidInputException);
    });

    it('throws BusinessRuleViolationException when the pool has no valid price', async () => {
      pools.findPoolById.mockResolvedValue(
        makePoolDetail({ currentSqrtPrice: '0' }),
      );

      await expect(service.getQuote(baseRequest)).rejects.toThrow(
        BusinessRuleViolationException,
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

      expect(result).toEqual({
        isLoading: false,
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        items: [
          expect.objectContaining({
            amount0: '150.50',
            amount1: '-75.25',
            feeAmount: '0.4515',
            poolId: 'pool-test-1',
            priceAtSwap: '2.0015',
            token0Symbol: 'USDC',
            token1Symbol: 'XLM',
            tokenPair: 'USDC/XLM',
            transactionHash: 'tx-hash-test-123',
            walletAddress: 'wallet-test-address-abc',
            id: expect.any(String),
            timestamp: expect.any(Number),
          }),
          expect.objectContaining({
            amount0: '1.5',
            amount1: '-3000.75',
            feeAmount: '4.50',
            poolId: 'pool-test-2',
            priceAtSwap: '2000.50',
            token0Symbol: 'ETH',
            token1Symbol: 'USDT',
            tokenPair: 'ETH/USDT',
            transactionHash: 'tx-hash-test-456',
            walletAddress: 'wallet-test-address-def',
            id: expect.any(String),
            timestamp: expect.any(Number),
          }),
        ],
      });
    });

    it('matches snapshot for empty swap list', async () => {
      repo.listSwaps.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result).toEqual({
        items: [],
        total: 0,
        totalPages: 0,
        page: 1,
        limit: 10,
        isLoading: false,
      });
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
          }),
        ),
        total: 35,
      });

      const result = await service.getSwaps({ page: 2, limit: 5 });

      expect(result).toEqual({
        items: expect.any(Array),
        page: 2,
        limit: 5,
        total: 35,
        totalPages: 7,
        isLoading: false,
      });

      // Verify item structure matches expected shape
      result.items.forEach((item) => {
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
