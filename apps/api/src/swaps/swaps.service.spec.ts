import { Pool, Token } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import { SwapErrorCode, SwapSnapshot } from './swap.types';
import {
  SlippageExceededException,
  UnknownTokenException,
} from '../request-validation/http.exceptions';

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

const makeToken = (overrides: Partial<Token> = {}): Token =>
  ({
    id: 'tok-1',
    address: 'USDC-addr',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUri: null,
    ...overrides,
  }) as Token;

describe('SwapsService', () => {
  let service: SwapsService;
  let repo: jest.Mocked<SwapsRepository>;

  beforeEach(async () => {
    repo = {
      listSwaps: jest.fn(),
      findTokenByAddress: jest.fn(),
      findPoolByTokenPair: jest.fn(),
    } as unknown as jest.Mocked<SwapsRepository>;

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

  describe('getQuote()', () => {
    it('throws UnknownTokenException with UNKNOWN_TOKEN code when tokenIn is unknown', async () => {
      repo.findTokenByAddress
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeToken({ address: 'XLM-addr', symbol: 'XLM' }),
        );

      let caught: UnknownTokenException | undefined;
      try {
        await service.getQuote({
          tokenIn: 'unknown-in',
          tokenOut: 'XLM-addr',
          amountIn: '100',
        });
      } catch (err) {
        caught = err as UnknownTokenException;
      }

      expect(caught).toBeInstanceOf(UnknownTokenException);
      const response = caught!.getResponse() as Record<string, unknown>;
      expect(response.code).toBe(SwapErrorCode.UNKNOWN_TOKEN);
      expect(repo.findPoolByTokenPair).not.toHaveBeenCalled();
    });

    it('throws UnknownTokenException when tokenOut is unknown', async () => {
      repo.findTokenByAddress
        .mockResolvedValueOnce(makeToken())
        .mockResolvedValueOnce(null);

      await expect(
        service.getQuote({
          tokenIn: 'USDC-addr',
          tokenOut: 'unknown-out',
          amountIn: '100',
        }),
      ).rejects.toThrow(UnknownTokenException);
    });

    it('returns quote shape for a known token pair', async () => {
      repo.findTokenByAddress
        .mockResolvedValueOnce(makeToken())
        .mockResolvedValueOnce(
          makeToken({
            id: 'tok-2',
            address: 'XLM-addr',
            symbol: 'XLM',
            name: 'Stellar',
          }),
        );
      repo.findPoolByTokenPair.mockResolvedValue({
        id: 'pool-1',
        token0Address: 'USDC-addr',
        token1Address: 'XLM-addr',
        feeTier: 30,
        currentSqrtPrice: '1',
        currentTick: 0,
        liquidity: '0',
        tvl: '100',
        volume24h: '50',
        feeApr: '2.5',
        currentPrice: '2',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      } as Pool);

      const quote = await service.getQuote({
        tokenIn: 'USDC-addr',
        tokenOut: 'XLM-addr',
        amountIn: '100',
        slippageBps: 50,
      });

      expect(quote).toEqual({
        tokenIn: 'USDC-addr',
        tokenOut: 'XLM-addr',
        tokenInSymbol: 'USDC',
        tokenOutSymbol: 'XLM',
        amountIn: '100',
        amountOut: '200',
        executionPrice: '2',
        minimumReceived: '199',
        priceImpact: 0,
        poolId: 'pool-1',
        slippageBps: 50,
      });
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

      const sanitizedResult = {
        ...result,
        items: result.items.map((item) => ({
          ...item,
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
