import { Pool, Swap, Position, Token } from '@prisma/client';
import { TickData } from '../pools/pools.repository';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

export const createMockPrismaService = () => ({
  pool: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  swap: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  price: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  position: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  tick: {
    findMany: jest.fn(),
  },
  token: {
    findUnique: jest.fn(),
  },
  ohlcv: {
    findMany: jest.fn(),
  },
});

// ─── CacheService mock factory ───────────────────────────────────────────────

export const createMockCacheService = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidatePattern: jest.fn().mockResolvedValue(undefined),
});

// ─── PoolsRepository mock factory ────────────────────────────────────────────

export const createMockPoolsRepository = () => ({
  listActivePools: jest.fn(),
  upsertPoolState: jest.fn(),
  getTicksByPoolId: jest.fn(),
  poolExists: jest.fn().mockResolvedValue(true),
  getPoolDetailById: jest.fn(),
});

// ─── Redis mock factory ───────────────────────────────────────────────────────

export const createMockRedisService = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
});

// ─── Data stubs ───────────────────────────────────────────────────────────────
// Field shapes mirror the Prisma models in prisma/schema.prisma (Token, Pool,
// Swap) — keep them in sync if those models change.

export const mockToken = (overrides: Partial<Token> = {}): Token => ({
  id: 'tok_usdc_1',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUri: null,
  ...overrides,
});

const mockToken1 = (overrides: Partial<Token> = {}): Token =>
  mockToken({
    id: 'tok_eth_1',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    ...overrides,
  });

export const mockPool = (overrides: Partial<Pool> = {}): Pool => ({
  id: 'pool_1',
  token0Address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  token1Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  feeTier: 3000,
  currentSqrtPrice: '79228162514264337593543950336',
  currentTick: 0,
  liquidity: '1000000000000000000',
  tvl: '5000000',
  volume24h: '1200000',
  feeApr: '0.15',
  currentPrice: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-06-01T00:00:00Z'),
  ...overrides,
});

export const mockSwap = (overrides: Partial<Swap> = {}): Swap => ({
  id: 'swap_1',
  eventId: 'event_1',
  poolId: 'pool_1',
  senderAddress: '0xSender1',
  recipientAddress: '0xRecipient1',
  amount0: '1000000',
  amount1: '500000000000000000',
  sqrtPriceAfter: '79228162514264337593543950336',
  tickAfter: 0,
  transactionHash: '0xTxHash1',
  feeAmount: '0',
  timestamp: new Date('2024-06-01T12:00:00Z'),
  ...overrides,
});

/**
 * Composite shape returned by `PoolsRepository.getPoolDetailById()` — the raw
 * pool row (with its recent `swaps`) plus each side's token row — which is
 * what `PoolsService.findPoolById()` maps into the PoolDetail response. To
 * simulate an unenriched token lookup, override `token0`/`token1` to `null`
 * on the returned object rather than through this factory's params, e.g.
 * `{ ...mockPoolDetailData(), token0: null, token1: null }`.
 */
export const mockPoolDetailData = (
  overrides: { pool?: Partial<Pool>; swaps?: Swap[] } = {},
) => ({
  pool: { ...mockPool(overrides.pool), swaps: overrides.swaps ?? [] },
  token0: mockToken(),
  token1: mockToken1(),
});

export const mockPosition = (overrides: Partial<Position> = {}): Position => ({
  id: 'pos_1',
  poolId: 'pool_1',
  owner: '0xWalletOwner1',
  tokenId: 1,
  liquidity: '500000000000000000',
  tickLower: -887272,
  tickUpper: 887272,
  token0Deposited: '1000000',
  token1Deposited: '500000000000000000',
  token0Withdrawn: '0',
  token1Withdrawn: '0',
  feesEarned0: '5000',
  feesEarned1: '2500000000000000',
  valueUsd: 2_000,
  status: 'ACTIVE',
  createdAt: new Date('2024-05-01T00:00:00Z'),
  updatedAt: new Date('2024-06-01T00:00:00Z'),
  ...overrides,
});

export const mockTick = (overrides: Partial<TickData> = {}): TickData => ({
  tickIndex: 0,
  liquidityNet: '1000000000000000000',
  liquidityGross: '1000000000000000000',
  feeGrowthOutside0X128: '0',
  feeGrowthOutside1X128: '0',
  ...overrides,
});

// ─── Pagination helpers ───────────────────────────────────────────────────────

export const paginatedResponse = <T>(
  items: T[],
  total: number,
  page = 1,
  limit = 10,
) => ({ items, total, page, limit, pages: Math.ceil(total / limit) });
