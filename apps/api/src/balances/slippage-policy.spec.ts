import {
  SLIPPAGE_POLICY,
  SLIPPAGE_ERROR_CODES,
  POSITION_NFT_TICK_RANGE,
  POSITION_NFT_ERROR_CODES,
  POSITION_NFT_METADATA_VERSION,
} from './balances.service';

describe('SLIPPAGE_POLICY', () => {
  it('pins the inclusive clamp bounds', () => {
    expect(SLIPPAGE_POLICY.minToleranceBps).toBe(1);
    expect(SLIPPAGE_POLICY.maxToleranceBps).toBe(500);
    expect(SLIPPAGE_POLICY.minDeadlineSeconds).toBe(5);
    expect(SLIPPAGE_POLICY.maxDeadlineSeconds).toBe(300);
  });

  it('exposes the documented error codes', () => {
    expect(SLIPPAGE_ERROR_CODES.INVALID_TOLERANCE).toBe('SLIPPAGE_INVALID_TOLERANCE');
    expect(SLIPPAGE_ERROR_CODES.INVALID_DEADLINE).toBe('SLIPPAGE_INVALID_DEADLINE');
  });

  describe('tolerance bounds', () => {
    it('accepts the inclusive lower bound of 1 bps', () => {
      expect(SLIPPAGE_POLICY.minToleranceBps).toBe(1);
      expect(1).toBeGreaterThanOrEqual(SLIPPAGE_POLICY.minToleranceBps);
      expect(1).toBeLessThanOrEqual(SLIPPAGE_POLICY.maxToleranceBps);
    });

    it('accepts the inclusive upper bound of 500 bps', () => {
      expect(SLIPPAGE_POLICY.maxToleranceBps).toBe(500);
      expect(500).toBeGreaterThanOrEqual(SLIPPAGE_POLICY.minToleranceBps);
      expect(500).toBeLessThanOrEqual(SLIPPAGE_POLICY.maxToleranceBps);
    });

    it('rejects 0 with SLIPPAGE_INVALID_TOLERANCE', () => {
      const tolerance = 0;
      const rejected =
        tolerance < SLIPPAGE_POLICY.minToleranceBps ||
        tolerance > SLIPPAGE_POLICY.maxToleranceBps;
      expect(rejected).toBe(true);
      expect(SLIPPAGE_ERROR_CODES.INVALID_TOLERANCE).toBe('SLIPPAGE_INVALID_TOLERANCE');
    });

    it('rejects 501 with SLIPPAGE_INVALID_TOLERANCE', () => {
      const tolerance = 501;
      const rejected =
        tolerance < SLIPPAGE_POLICY.minToleranceBps ||
        tolerance > SLIPPAGE_POLICY.maxToleranceBps;
      expect(rejected).toBe(true);
      expect(SLIPPAGE_ERROR_CODES.INVALID_TOLERANCE).toBe('SLIPPAGE_INVALID_TOLERANCE');
    });
  });

  describe('deadline bounds', () => {
    it('accepts the inclusive lower bound of 5 seconds', () => {
      expect(SLIPPAGE_POLICY.minDeadlineSeconds).toBe(5);
      expect(5).toBeGreaterThanOrEqual(SLIPPAGE_POLICY.minDeadlineSeconds);
      expect(5).toBeLessThanOrEqual(SLIPPAGE_POLICY.maxDeadlineSeconds);
    });

    it('accepts the inclusive upper bound of 300 seconds', () => {
      expect(SLIPPAGE_POLICY.maxDeadlineSeconds).toBe(300);
      expect(300).toBeGreaterThanOrEqual(SLIPPAGE_POLICY.minDeadlineSeconds);
      expect(300).toBeLessThanOrEqual(SLIPPAGE_POLICY.maxDeadlineSeconds);
    });

    it('rejects 4 with SLIPPAGE_INVALID_DEADLINE', () => {
      const deadline = 4;
      const rejected =
        deadline < SLIPPAGE_POLICY.minDeadlineSeconds ||
        deadline > SLIPPAGE_POLICY.maxDeadlineSeconds;
      expect(rejected).toBe(true);
      expect(SLIPPAGE_ERROR_CODES.INVALID_DEADLINE).toBe('SLIPPAGE_INVALID_DEADLINE');
    });

    it('rejects 301 with SLIPPAGE_INVALID_DEADLINE', () => {
      const deadline = 301;
      const rejected =
        deadline < SLIPPAGE_POLICY.minDeadlineSeconds ||
        deadline > SLIPPAGE_POLICY.maxDeadlineSeconds;
      expect(rejected).toBe(true);
      expect(SLIPPAGE_ERROR_CODES.INVALID_DEADLINE).toBe('SLIPPAGE_INVALID_DEADLINE');
    });
  });
});

describe('POSITION_NFT_TICK_RANGE', () => {
  it('pins the inclusive tick range', () => {
    expect(POSITION_NFT_TICK_RANGE.minTick).toBe(-887272);
    expect(POSITION_NFT_TICK_RANGE.maxTick).toBe(887272);
  });

  it('exposes the documented error codes and metadata version', () => {
    expect(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE).toBe('POSITION_NFT_INVALID_TICK_RANGE');
    expect(POSITION_NFT_ERROR_CODES.UNSUPPORTED_METADATA_VERSION).toBe(
      'POSITION_NFT_UNSUPPORTED_METADATA_VERSION',
    );
    expect(POSITION_NFT_METADATA_VERSION).toBeDefined();
  });

  it('rejects tickLower === tickUpper with POSITION_NFT_INVALID_TICK_RANGE', () => {
    const tickLower = 100;
    const tickUpper = 100;
    const rejected = tickLower >= tickUpper;
    expect(rejected).toBe(true);
    expect(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE).toBe('POSITION_NFT_INVALID_TICK_RANGE');
  });

  it('rejects ticks below minTick with POSITION_NFT_INVALID_TICK_RANGE', () => {
    const tickLower = POSITION_NFT_TICK_RANGE.minTick - 1;
    const rejected = tickLower < POSITION_NFT_TICK_RANGE.minTick;
    expect(rejected).toBe(true);
    expect(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE).toBe('POSITION_NFT_INVALID_TICK_RANGE');
  });

  it('rejects ticks above maxTick with POSITION_NFT_INVALID_TICK_RANGE', () => {
    const tickUpper = POSITION_NFT_TICK_RANGE.maxTick + 1;
    const rejected = tickUpper > POSITION_NFT_TICK_RANGE.maxTick;
    expect(rejected).toBe(true);
    expect(POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE).toBe('POSITION_NFT_INVALID_TICK_RANGE');
  });

  it('rejects an unsupported metadataVersion with POSITION_NFT_UNSUPPORTED_METADATA_VERSION', () => {
    const metadataVersion = 'v0-unsupported';
    const rejected = metadataVersion !== POSITION_NFT_METADATA_VERSION;
    expect(rejected).toBe(true);
    expect(POSITION_NFT_ERROR_CODES.UNSUPPORTED_METADATA_VERSION).toBe(
      'POSITION_NFT_UNSUPPORTED_METADATA_VERSION',
    );
  });
});
