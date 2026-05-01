import { Pool, Swap, Position, Token } from '@prisma/client';
import { TickData } from '../pools/pools.repository';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

export const createMockPrismaService = () => ({
  pool: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
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
});

// ─── Redis mock factory ───────────────────────────────────────────────────────

export const createMockRedisService = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
});

// ─── Data stubs ───────────────────────────────────────────────────────────────

export const mockToken = (overrides: Partial<Token> = {}): Token => ({
  id: 'tok_usdc_1',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 1,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

export const mockPool = (overrides: Partial<Pool> = {}): Pool => ({
  id: 'pool_1',
  address: '0xPoolAddress1',
  token0Id: 'tok_usdc_1',
  token1Id: 'tok_eth_1',
  fee: 3000,
  liquidity: '1000000000000000000',
  sqrtPriceX96: '79228162514264337593543950336',
  tick: 0,
  tvlUsd: 5_000_000,
  volumeUsd24h: 1_200_000,
  feesUsd24h: 3_600,
  txCount: 12_000,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-06-01T00:00:00Z'),
  ...overrides,
});

export const mockSwap = (overrides: Partial<Swap> = {}): Swap => ({
  id: 'swap_1',
  poolId: 'pool_1',
  sender: '0xWalletSender1',
  recipient: '0xWalletRecipient1',
  amount0: '1000000',
  amount1: '-500000000000000000',
  amountUsd: 1_000,
  sqrtPriceX96: '79228162514264337593543950336',
  tick: 0,
  txHash: '0xTxHash1',
  blockNumber: 19_000_000,
  logIndex: 0,
  timestamp: new Date('2024-06-01T12:00:00Z'),
  ...overrides,
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

export const mockOhlcv = (overrides: Record<string, unknown> = {}) => ({
  id: 'ohlcv_1',
  poolId: 'pool_1',
  interval: '1h',
  open: 3_500,
  high: 3_600,
  low: 3_450,
  close: 3_575,
  volume: 250_000,
  timestamp: new Date('2024-06-01T12:00:00Z'),
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
