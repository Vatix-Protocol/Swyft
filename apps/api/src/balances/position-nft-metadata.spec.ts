import {
  POSITION_NFT_METADATA_VERSION,
  POSITION_NFT_TICK_RANGE,
  POSITION_NFT_ERROR_CODES,
  BalancesService,
} from './balances.service';

/**
 * Unit tests pinning the position NFT tick range and metadata version gates.
 * These assert the exact error codes so a future edit that widens
 * `POSITION_NFT_TICK_RANGE` or bumps the metadata version fails loudly.
 */
describe('POSITION_NFT_TICK_RANGE validation', () => {
  let service: BalancesService;

  const validPoolAddress = `C${'A'.repeat(55)}`;

  const baseRequest = () => ({
    positionId: 'position-1',
    poolAddress: validPoolAddress,
    tickLower: -100,
    tickUpper: 100,
    liquidity: '1000',
    metadataVersion: POSITION_NFT_METADATA_VERSION,
  });

  beforeEach(() => {
    service = new BalancesService({} as never, {} as never);
  });

  it('pins the documented tick range', () => {
    expect(POSITION_NFT_TICK_RANGE.minTick).toBe(-887272);
    expect(POSITION_NFT_TICK_RANGE.maxTick).toBe(887272);
  });

  it('accepts a valid in-range tick span', () => {
    const result = service.enforcePositionNftMetadata(baseRequest());
    expect(result.tickLower).toBe(-100);
    expect(result.tickUpper).toBe(100);
  });

  it('rejects tickLower === tickUpper with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      service.enforcePositionNftMetadata({
        ...baseRequest(),
        tickLower: 50,
        tickUpper: 50,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE);
  });

  it('rejects an inverted range with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      service.enforcePositionNftMetadata({
        ...baseRequest(),
        tickLower: 100,
        tickUpper: -100,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE);
  });

  it('rejects a tick below minTick with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      service.enforcePositionNftMetadata({
        ...baseRequest(),
        tickLower: POSITION_NFT_TICK_RANGE.minTick - 1,
        tickUpper: 100,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE);
  });

  it('rejects a tick above maxTick with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      service.enforcePositionNftMetadata({
        ...baseRequest(),
        tickLower: -100,
        tickUpper: POSITION_NFT_TICK_RANGE.maxTick + 1,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE);
  });

  it('rejects an unsupported metadataVersion with POSITION_NFT_UNSUPPORTED_METADATA_VERSION', () => {
    expect(() =>
      service.enforcePositionNftMetadata({
        ...baseRequest(),
        metadataVersion: POSITION_NFT_METADATA_VERSION + 1,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.UNSUPPORTED_METADATA_VERSION);
  });
});
