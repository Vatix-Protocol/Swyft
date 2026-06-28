import { PriceService } from '../price/price.service';
import { PositionSnapshot } from './position.types';
import { PositionsRepository } from './positions.repository';
import { PositionsService } from './positions.service';

const makeSnapshot = (
  overrides: Partial<PositionSnapshot> = {},
): PositionSnapshot => ({
  id: 'pos-1',
  ownerWallet: 'wallet-owner-1',
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
  poolCurrentPrice: 1.25,
  ...overrides,
});

describe('PositionsService', () => {
  let service: PositionsService;
  let repository: { listPositionsByWallet: jest.Mock };
  let priceService: { getSpotPrice: jest.Mock };

  beforeEach(() => {
    repository = {
      listPositionsByWallet: jest.fn(),
    };
    priceService = {
      getSpotPrice: jest.fn().mockResolvedValue(null),
    };

    service = new PositionsService(
      repository as unknown as PositionsRepository,
      priceService as unknown as PriceService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('getPositions() — list response', () => {
    it('includes ownerWallet for each item, matching the underlying snapshot', async () => {
      const snapshots = [
        makeSnapshot({ id: 'pos-1', ownerWallet: 'wallet-owner-1' }),
        makeSnapshot({ id: 'pos-2', ownerWallet: 'wallet-owner-2' }),
      ];
      repository.listPositionsByWallet.mockResolvedValue({
        items: snapshots,
        total: 2,
      });

      const result = await service.getPositions('wallet-owner-1', {
        status: 'all',
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: 'pos-1',
        ownerWallet: 'wallet-owner-1',
      });
      expect(result.items[1]).toMatchObject({
        id: 'pos-2',
        ownerWallet: 'wallet-owner-2',
      });
    });

    it('does not fabricate ownerWallet — it is passed through from the snapshot unchanged', async () => {
      const snapshot = makeSnapshot({ ownerWallet: 'GSOMESTELLARADDR' });
      repository.listPositionsByWallet.mockResolvedValue({
        items: [snapshot],
        total: 1,
      });

      const result = await service.getPositions('GSOMESTELLARADDR', {
        status: 'all',
        page: 1,
        limit: 20,
      });

      expect(result.items[0].ownerWallet).toBe(snapshot.ownerWallet);
    });

    it('returns an empty items array when there are no positions', async () => {
      repository.listPositionsByWallet.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await service.getPositions('wallet-owner-1', {
        status: 'all',
        page: 1,
        limit: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
