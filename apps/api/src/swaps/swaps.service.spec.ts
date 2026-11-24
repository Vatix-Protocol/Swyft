import { Pool, Token } from '@prisma/client';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as swyftSdk from '@swyft/sdk';
import { SwapsService } from './swaps.service';
import { SwapsRepository } from './swaps.repository';
import {
  SLIPPAGE_BPS_DEFAULT,
  SLIPPAGE_BPS_MAX,
  SLIPPAGE_BPS_MIN,
  SwapErrorCode,
  SwapSnapshot,
} from './swap.types';
import { GetSwapQuoteQueryDto } from './dto/get-swap-quote-query.dto';
import { SwapQuoteRequestDto } from './dto/swap-quote-request.dto';
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
  clPool: {
    source: 'pool',
    derived: true,
    poolId: 'pool-1',
    derivedAt: 1_700_000_000_000,
    sqrtPriceX96: '79228162514264337593543950336000000',
    tick: 0,
    liquidity: '5000000000000000000000000',
    tickSpacing: 60,
  },
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

    it('trims poolId and wallet filters and omits whitespace-only filters', async () => {
      repo.listSwaps.mockResolvedValue({ items: [], total: 0 });

      await service.getSwaps({
        poolId: ' pool-abc ',
        wallet: ' wallet-abc ',
        page: 1,
        limit: 10,
      });

      expect(repo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: 'pool-abc', wallet: 'wallet-abc' }),
      );

      repo.listSwaps.mockClear();
      await service.getSwaps({
        poolId: ' ',
        wallet: '   ',
        page: 1,
        limit: 10,
      });

      expect(repo.listSwaps).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: undefined, wallet: undefined }),
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

    it('exposes route as the single route field on each response item', async () => {
      repo.listSwaps.mockResolvedValue({
        items: [makeSnapshot({ route: ['pool-1', 'pool-2'] })],
        total: 1,
      });

      const result = await service.getSwaps({ page: 1, limit: 10 });

      expect(result.items[0].route).toEqual(['pool-1', 'pool-2']);
      expect(result.items[0]).not.toHaveProperty('routeLeg');
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

    it('throws ResourceNotFoundException using the request pool id and never calls the SDK (#1360)', async () => {
      const getSwapQuoteSpy = jest.spyOn(swyftSdk, 'getSwapQuote');
      pools.findPoolById.mockResolvedValue(null);

      const result = service.getQuote({
        ...baseRequest,
        poolId: 'pool-missing',
      });

      await expect(result).rejects.toThrow(ResourceNotFoundException);
      await expect(result).rejects.toThrow('pool-missing');
      expect(getSwapQuoteSpy).not.toHaveBeenCalled();

      getSwapQuoteSpy.mockRestore();
    });

    it('prices without a real tick fee growth outside (#1362)', async () => {
      const getSwapQuoteSpy = jest
        .spyOn(swyftSdk, 'getSwapQuote')
        .mockReturnValue({
          amountOut: '1000000',
          priceImpact: 0,
          fee: '3000',
          minimumReceived: '990000',
          sqrtPriceLimitX96: '79228162514264337593543950336',
        });
      pools.findPoolById.mockResolvedValue(makePoolDetail());
      pools.getPoolTicks.mockResolvedValue([
        {
          tickIndex: -100,
          liquidityNet: '1000000000000000000',
          liquidityGross: '1000000000000000000',
          feeGrowthOutside0X128: '123456789',
          feeGrowthOutside1X128: '987654321',
        },
      ]);

      await expect(service.getQuote(baseRequest)).resolves.toBeDefined();

      const call = getSwapQuoteSpy.mock.calls[0][0] as {
        poolState: { ticks: Array<{ tick: number; feeGrowthOutside: string }> };
      };
      // The SDK quote math ignores fee growth outside; the mapper supplies a
      // placeholder '0' that satisfies the tick type without affecting price.
      expect(call.poolState.ticks[0]).toEqual(
        expect.objectContaining({ tick: -100, feeGrowthOutside: '0' }),
      );

      getSwapQuoteSpy.mockRestore();
    });

    it('throws InvalidInputException when tokenIn/tokenOut do not match the pool', async () => {
      pools.findPoolById.mockResolvedValue(makePoolDetail());

      await expect(
        service.getQuote({ ...baseRequest, tokenOut: '0xSomeOtherToken' }),
      ).rejects.toThrow(InvalidInputException);
    });

    it('throws InvalidInputException for a token that is not in the pool (#1359)', () => {
      const pool = makePoolDetail();
      expect(() =>
        service['resolveDirection'](
          pool,
          '0xNotInThePool',
          pool.token1.address,
        ),
      ).toThrow(InvalidInputException);
    });

    it('returns true for token0 -> token1 (#1359)', () => {
      const pool = makePoolDetail();
      expect(
        service['resolveDirection'](
          pool,
          pool.token0.address,
          pool.token1.address,
        ),
      ).toBe(true);
    });

    it('returns false for token1 -> token0 (#1359)', () => {
      const pool = makePoolDetail();
      expect(
        service['resolveDirection'](
          pool,
          pool.token1.address,
          pool.token0.address,
        ),
      ).toBe(false);
    });

    it('throws BusinessRuleViolationException when the pool has no valid price', async () => {
      pools.findPoolById.mockResolvedValue(
        makePoolDetail({ currentSqrtPrice: '0' }),
      );

      await expect(service.getQuote(baseRequest)).rejects.toThrow(
        BusinessRuleViolationException,
      );
    });

    it.each(['', 'abc', '-1', '1e2'])(
      'throws when the sqrt price is the non-integer string %p',
      async (currentSqrtPrice) => {
        pools.findPoolById.mockResolvedValue(
          makePoolDetail({ currentSqrtPrice }),
        );

        await expect(service.getQuote(baseRequest)).rejects.toThrow(
          BusinessRuleViolationException,
        );
      },
    );

    it('decodes a sqrt price of 2^96 to a spot price of 1', () => {
      expect(service['spotPrice']((1n << 96n).toString())).toBe('1');
    });

    it.each(['-1', '+1'])(
      'rejects amountIn %p with a leading sign as invalid input',
      async (amountIn) => {
        pools.findPoolById.mockResolvedValue(makePoolDetail());

        await expect(
          service.getQuote({ ...baseRequest, amountIn }),
        ).rejects.toThrow(
          'amountIn must be a plain non-negative decimal string',
        );
        expect(() => service['toBaseUnits'](amountIn, 6)).toThrow(
          InvalidInputException,
        );
      },
    );

    it.each(['0', '0.000'])(
      'rejects a non-positive amountIn %p at the token decimals',
      async (amountIn) => {
        pools.findPoolById.mockResolvedValue(makePoolDetail());

        await expect(
          service.getQuote({ ...baseRequest, amountIn }),
        ).rejects.toThrow(InvalidInputException);
        await expect(
          service.getQuote({ ...baseRequest, amountIn }),
        ).rejects.toThrow('amountIn must be greater than zero');
      },
    );

    it('lets an amountIn of "1" past validation to the SDK quote', async () => {
      pools.findPoolById.mockResolvedValue(makePoolDetail());

      const outcome: unknown = await service
        .getQuote({ ...baseRequest, amountIn: '1' })
        .catch((err: unknown) => err);

      expect(outcome).not.toBeInstanceOf(InvalidInputException);
    });

    it('keeps "1.0" valid at 1 decimal', () => {
      expect(service['toBaseUnits']('1.0', 1)).toBe(10n);
    });

    it('computes execution price with integer division for amounts above Number.MAX_SAFE_INTEGER', () => {
      // 2^53 + 1 is not representable as a Number; float math would yield 1.
      const amountIn = BigInt('9007199254740993');
      const amountOut = BigInt('9007199254740992');

      const price = service['executionPrice'](amountIn, 0, amountOut, 0);

      expect(price).toBe('0.999999999999999888');
      expect(price).toBe(
        service['fromBaseUnits']((amountOut * 10n ** 18n) / amountIn, 18),
      );
    });

    it.each([
      [1n, 2, '0.01'],
      [100n, 2, '1'],
      [150n, 2, '1.5'],
    ])(
      'fromBaseUnits(%p at %p decimals) strips trailing zeros to %p (#1361)',
      (amount, decimals, expected) => {
        expect(service['fromBaseUnits'](amount, decimals)).toBe(expected);
      },
    );
  });

  // ── #1359: resolveDirection rejects tokens not in the pool ────────────────

  describe('resolveDirection()', () => {
    // Addresses are compared exactly as the pool stores them (no lowercasing).
    const pool = makePoolDetail();
    const token0 = pool.token0.address;
    const token1 = pool.token1.address;

    it('throws InvalidInputException for a stranger token', () => {
      expect(() =>
        service['resolveDirection'](pool, token0, '0xStrangerToken'),
      ).toThrow(InvalidInputException);
      expect(() =>
        service['resolveDirection'](pool, '0xStrangerToken', token1),
      ).toThrow(InvalidInputException);
    });

    it('returns true for token0 -> token1', () => {
      expect(service['resolveDirection'](pool, token0, token1)).toBe(true);
    });

    it('returns false for token1 -> token0', () => {
      expect(service['resolveDirection'](pool, token1, token0)).toBe(false);
    });
  });

  describe('concurrent getSwaps()', () => {
    it('resolves overlapping calls with their own rows without shared loading state', async () => {
      expect(service).not.toHaveProperty('_isLoading');

      let resolveFirst!: (v: { items: SwapSnapshot[]; total: number }) => void;
      let resolveSecond!: (v: { items: SwapSnapshot[]; total: number }) => void;
      repo.listSwaps
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveFirst = resolve)),
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveSecond = resolve)),
        );

      const first = service.getSwaps({ poolId: 'pool-1', page: 1, limit: 10 });
      const second = service.getSwaps({ poolId: 'pool-2', page: 1, limit: 10 });

      resolveSecond({ items: [makeSnapshot({ id: 'swap-b' })], total: 1 });
      resolveFirst({ items: [makeSnapshot({ id: 'swap-a' })], total: 1 });

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult.items.map((s) => s.id)).toEqual(['swap-a']);
      expect(secondResult.items.map((s) => s.id)).toEqual(['swap-b']);
      expect(service).not.toHaveProperty('_isLoading');
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

  // ── #1208: slippageBps unit + bounds ───────────────────────────────────────

  describe('slippageBps validation', () => {
    // Same options as the global pipe registered in app.setup.ts.
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const validQuery = {
      tokenIn: 'CCUSDC',
      tokenOut: 'CXLM',
      amountIn: '100',
    };
    const validBody = {
      poolId: 'pool-1',
      tokenIn: '0xTokenA',
      tokenOut: '0xTokenB',
      amountIn: '100',
    };

    const cases: Array<[string, unknown, string]> = [
      [
        'a negative value',
        SLIPPAGE_BPS_MIN - 1,
        `slippageBps must be at least ${SLIPPAGE_BPS_MIN}`,
      ],
      [
        'a value above the maximum',
        SLIPPAGE_BPS_MAX + 1,
        `slippageBps must not be greater than ${SLIPPAGE_BPS_MAX}`,
      ],
      ['a non-integer value', 12.5, 'slippageBps must be an integer number'],
    ];

    const expectRejected = async (
      promise: Promise<unknown>,
      message: string,
    ) => {
      const error = await promise.then(
        () => {
          throw new Error('expected validation to fail');
        },
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(BadRequestException);
      const exception = error as BadRequestException;
      expect(exception.getStatus()).toBe(400);
      expect(exception.getResponse()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [message],
      });
    };

    describe('GetSwapQuoteQueryDto', () => {
      const parse = (raw: Record<string, unknown>) =>
        pipe.transform(raw, { type: 'query', metatype: GetSwapQuoteQueryDto });

      it.each(cases)(
        'rejects %s with a 400',
        async (_label, value, message) => {
          await expectRejected(
            parse({ ...validQuery, slippageBps: String(value) }),
            message,
          );
        },
      );

      it.each([SLIPPAGE_BPS_MIN, SLIPPAGE_BPS_MAX])(
        'accepts the inclusive bound %d',
        async (value) => {
          const dto = await parse({
            ...validQuery,
            slippageBps: String(value),
          });
          expect(dto.slippageBps).toBe(value);
        },
      );

      it('defaults slippageBps when omitted', async () => {
        const dto = await parse(validQuery);
        expect(dto.slippageBps).toBe(SLIPPAGE_BPS_DEFAULT);
      });
    });

    describe('SwapQuoteRequestDto', () => {
      const parse = (raw: Record<string, unknown>) =>
        pipe.transform(raw, { type: 'body', metatype: SwapQuoteRequestDto });

      it.each(cases)(
        'rejects %s with a 400',
        async (_label, value, message) => {
          await expectRejected(
            parse({ ...validBody, slippageBps: value }),
            message,
          );
        },
      );

      it.each([SLIPPAGE_BPS_MIN, SLIPPAGE_BPS_MAX])(
        'accepts the inclusive bound %d',
        async (value) => {
          const dto = await parse({ ...validBody, slippageBps: value });
          expect(dto.slippageBps).toBe(value);
        },
      );
    });
  });
});
