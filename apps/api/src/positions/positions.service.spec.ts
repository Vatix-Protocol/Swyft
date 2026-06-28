import { PositionsService } from './positions.service';
import { PositionsRepository } from './positions.repository';
import { PriceService, PriceEvent } from '../price/price.service';
import { PositionSnapshot } from './position.types';

const makeSnapshot = (
  overrides: Partial<PositionSnapshot> = {},
): PositionSnapshot => ({
  id: 'pos-1',
  ownerWallet: 'wallet-owner',
  poolId: 'pool-1',
  token0: 'USDC',
  token1: 'XLM',
  lowerTick: -60,
  upperTick: 60,
  liquidity: '50',
  currentValueUsd: 500,
  uncollectedFeesToken0: '1',
  uncollectedFeesToken1: '2',
  createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
  closedAt: null,
  status: 'active',
  poolCurrentPrice: 1,
  ...overrides,
});

describe('PositionsService', () => {
  let service: PositionsService;
  let mockRepository: jest.Mocked<
    Pick<PositionsRepository, 'listPositionsByWallet'>
  >;
  let mockPriceService: jest.Mocked<Pick<PriceService, 'getSpotPrice'>>;

  beforeEach(() => {
    mockRepository = {
      listPositionsByWallet: jest.fn(),
    };
    mockPriceService = {
      getSpotPrice: jest.fn().mockResolvedValue(null),
    };
    service = new PositionsService(
      mockRepository as unknown as PositionsRepository,
      mockPriceService as unknown as PriceService,
    );
  });

  const runWithPrice = async (
    snapshot: PositionSnapshot,
    currentPrice: number,
  ) => {
    mockRepository.listPositionsByWallet.mockResolvedValue({
      items: [snapshot],
      total: 1,
    });
    mockPriceService.getSpotPrice.mockResolvedValue({
      poolId: snapshot.poolId,
      currentPrice: currentPrice.toString(),
      sqrtPrice: '0',
      tick: 0,
      liquidity: '0',
      timestamp: 0,
    } as PriceEvent);

    const result = await service.getPositions('wallet-owner', {
      status: 'all',
      page: 1,
      limit: 20,
    } as never);

    return result.items[0];
  };

  it('reports in-range when current price sits strictly between tick bounds', async () => {
    // lowerTick=-60 -> price ~0.994018, upperTick=60 -> price ~1.006018
    const snapshot = makeSnapshot({ lowerTick: -60, upperTick: 60 });
    const item = await runWithPrice(snapshot, 1.0);

    expect(item.rangeStatus).toBe('in-range');
  });

  it('reports out-of-range when current price is below the lower tick bound', async () => {
    // lowerTick=0 -> price=1, upperTick=1000 -> price ~1.105
    const snapshot = makeSnapshot({ lowerTick: 0, upperTick: 1000 });
    const item = await runWithPrice(snapshot, 0.5);

    expect(item.rangeStatus).toBe('out-of-range');
  });

  it('reports out-of-range when current price is above the upper tick bound', async () => {
    // lowerTick=0 -> price=1, upperTick=1000 -> price ~1.105
    const snapshot = makeSnapshot({ lowerTick: 0, upperTick: 1000 });
    const item = await runWithPrice(snapshot, 2.0);

    expect(item.rangeStatus).toBe('out-of-range');
  });

  it('reports out-of-range when current price exactly equals the lower tick bound (exclusive boundary)', async () => {
    const lowerTick = 0;
    const upperTick = 1000;
    const lowerPrice = Math.pow(1.0001, lowerTick); // 1
    const snapshot = makeSnapshot({ lowerTick, upperTick });

    const item = await runWithPrice(snapshot, lowerPrice);

    expect(item.rangeStatus).toBe('out-of-range');
  });

  it('reports out-of-range when current price exactly equals the upper tick bound (exclusive boundary)', async () => {
    const lowerTick = 0;
    const upperTick = 1000;
    const upperPrice = Math.pow(1.0001, upperTick);
    const snapshot = makeSnapshot({ lowerTick, upperTick });

    const item = await runWithPrice(snapshot, upperPrice);

    expect(item.rangeStatus).toBe('out-of-range');
  });

  it('reports in-range for a full-range position regardless of price', async () => {
    const snapshot = makeSnapshot({ lowerTick: -887220, upperTick: 887220 });
    const item = await runWithPrice(snapshot, 1.25);

    expect(item.rangeStatus).toBe('in-range');
  });

  it('returns null rangeStatus for closed positions', async () => {
    const snapshot = makeSnapshot({
      lowerTick: -60,
      upperTick: 60,
      status: 'closed',
      closedAt: Date.now(),
    });
    const item = await runWithPrice(snapshot, 1.0);

    expect(item.rangeStatus).toBeNull();
  });

  it('falls back to poolCurrentPrice when no live price is available', async () => {
    const snapshot = makeSnapshot({
      lowerTick: -60,
      upperTick: 60,
      poolCurrentPrice: 1.0,
    });
    mockRepository.listPositionsByWallet.mockResolvedValue({
      items: [snapshot],
      total: 1,
    });
    mockPriceService.getSpotPrice.mockResolvedValue(null);

    const result = await service.getPositions('wallet-owner', {
      status: 'all',
      page: 1,
      limit: 20,
    } as never);

    expect(result.items[0].rangeStatus).toBe('in-range');
  });
});
