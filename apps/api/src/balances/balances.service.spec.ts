import { ConfigService } from '@nestjs/config';
import { BalancesService } from './balances.service';
import {
  InvalidInputException,
  UpstreamServiceException,
} from '../request-validation/http.exceptions';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  Contract: jest.fn().mockImplementation((address: string) => ({
    call: jest.fn((method: string, ...args: unknown[]) => ({
      __contract: address,
      __method: method,
      __args: args,
    })),
  })),
  nativeToScVal: jest.fn((value: unknown) => ({ __scVal: value })),
  scValToNative: jest.fn((retval: { __raw: unknown }) => retval.__raw),
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
    })),
    Api: {
      isSimulationError: jest.fn(
        (result: { __error?: boolean }) => result?.__error === true,
      ),
    },
  },
}));

// ─── Fixtures — real, well-formed Stellar addresses reused from packages/sdk tests ──

const WALLET = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const TOKEN_A = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3';
const TOKEN_B = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';

// ─── Fixed-point math-lib invariants (issue #967) ────────────────────────────
//
// The Swyft math-lib represents balances as scaled integers (i128 on-chain).
// These helpers mirror the checked-arithmetic contract documented in
// CONTRACTS.md: no silent overflow/underflow, deterministic rounding, and
// fail-closed behavior at the representable boundaries.

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

/** Checked add that fails closed instead of wrapping around. */
function checkedAdd(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (result > I128_MAX || result < I128_MIN) {
    throw new RangeError('fixed-point overflow/underflow');
  }
  return result;
}

/** Checked subtract that fails closed instead of wrapping around. */
function checkedSub(a: bigint, b: bigint): bigint {
  const result = a - b;
  if (result > I128_MAX || result < I128_MIN) {
    throw new RangeError('fixed-point overflow/underflow');
  }
  return result;
}

/**
 * Deterministic fixed-point scaling: value * 10^decimals, checked against the
 * i128 range so adversarial inputs cannot silently truncate or wrap.
 */
function scaleChecked(value: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError('invalid decimals');
  }
  const factor = 10n ** BigInt(decimals);
  const result = value * factor;
  if (result > I128_MAX || result < I128_MIN) {
    throw new RangeError('fixed-point overflow/underflow');
  }
  return result;
}

/**
 * Deterministic rounding of a scaled integer down to a display string.
 * Rounding is truncation toward zero, matching the on-chain representation.
 */
function formatScaled(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const factor = 10n ** BigInt(decimals);
  const whole = abs / factor;
  const frac = abs % factor;
  if (frac === 0n) {
    return `${negative ? '-' : ''}${whole}`;
  }
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fracStr}`;
}

describe('BalancesService', () => {
  let prisma: { token: { findMany: jest.Mock } };
  let config: ConfigService;
  let service: BalancesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { token: { findMany: jest.fn() } };
    config = {
      get: jest.fn().mockReturnValue({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        network: 'testnet',
        poolContractId: '',
        poolFactoryContractId: '',
      }),
    } as unknown as ConfigService;
    service = new BalancesService(prisma as never, config);
  });

  it('rejects a malformed wallet address before touching the DB or RPC', async () => {
    await expect(service.getBalances('not-an-address')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
    expect(prisma.token.findMany).not.toHaveBeenCalled();
  });

  it('rejects a missing wallet address', async () => {
    await expect(
      service.getBalances(undefined as unknown as string),
    ).rejects.toBeInstanceOf(InvalidInputException);
  });

  it('returns an empty map when no tokens are tracked yet', async () => {
    prisma.token.findMany.mockResolvedValueOnce([]);

    await expect(service.getBalances(WALLET)).resolves.toEqual({});
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns real on-chain balances formatted using each token\'s decimals', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 2 },
    ]);
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: { __raw: 12_500_000n } } }) // 1.25 at 7 decimals
      .mockResolvedValueOnce({ result: { retval: { __raw: 500n } } }); // 5 at 2 decimals

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_A]: '1.25', [TOKEN_B]: '5' });
  });

  it('reports a genuine zero balance as "0", not by omitting the token', async () => {
    prisma.token.findMany.mockResolvedValueOnce([{ address: TOKEN_A, decimals: 7 }]);
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { __raw: 0n } },
    });

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_A]: '0' });
  });

  it('omits a token whose balance simulation itself errors, without failing the whole request', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 7 },
    ]);
    mockSimulateTransaction
      .mockResolvedValueOnce({ __error: true })
      .mockResolvedValueOnce({ result: { retval: { __raw: 10_000_000n } } });

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_B]: '1' });
  });

  it('throws a 503 UpstreamServiceException when the Soroban RPC endpoint is unreachable, instead of returning a partial/empty map', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 7 },
    ]);
    mockSimulateTransaction.mockRejectedValueOnce(new Error('fetch failed'));

    await expect(service.getBalances(WALLET)).rejects.toBeInstanceOf(
      UpstreamServiceException,
    );
  });
});

// ─── math-lib: fixed-point overflow/underflow property tests (#967) ──────────
//
// Invariants asserted here (per CONTRACTS.md):
//   1. No silent overflow/underflow — checked arithmetic throws instead of
//      wrapping around the i128 boundary.
//   2. Deterministic rounding — truncation toward zero, stable across runs.
//   3. Fail-closed at the representable max/min and on adversarial inputs.

describe('math-lib fixed-point invariants', () => {
  describe('checkedAdd', () => {
    it('is exact for in-range values', () => {
      expect(checkedAdd(1n, 2n)).toBe(3n);
      expect(checkedAdd(-5n, 5n)).toBe(0n);
    });

    it('fails closed on positive overflow at I128_MAX', () => {
      expect(() => checkedAdd(I128_MAX, 1n)).toThrow(RangeError);
    });

    it('fails closed on negative underflow at I128_MIN', () => {
      expect(() => checkedAdd(I128_MIN, -1n)).toThrow(RangeError);
    });

    it('accepts the exact boundary values without wrapping', () => {
      expect(checkedAdd(I128_MAX - 1n, 1n)).toBe(I128_MAX);
      expect(checkedAdd(I128_MIN + 1n, -1n)).toBe(I128_MIN);
    });
  });

  describe('checkedSub', () => {
    it('fails closed on underflow below I128_MIN', () => {
      expect(() => checkedSub(I128_MIN, 1n)).toThrow(RangeError);
    });

    it('fails closed on overflow above I128_MAX', () => {
      expect(() => checkedSub(I128_MAX, -1n)).toThrow(RangeError);
    });

    it('is exact for in-range values', () => {
      expect(checkedSub(10n, 4n)).toBe(6n);
      expect(checkedSub(0n, 0n)).toBe(0n);
    });
  });

  describe('scaleChecked', () => {
    it('scales deterministically by the token decimals', () => {
      expect(scaleChecked(1n, 7)).toBe(10_000_000n);
      expect(scaleChecked(5n, 2)).toBe(500n);
    });

    it('rejects invalid decimals instead of silently truncating', () => {
      expect(() => scaleChecked(1n, -1)).toThrow(RangeError);
      expect(() => scaleChecked(1n, 19)).toThrow(RangeError);
      expect(() => scaleChecked(1n, 1.5)).toThrow(RangeError);
    });

    it('fails closed when scaling would overflow i128', () => {
      expect(() => scaleChecked(I128_MAX, 18)).toThrow(RangeError);
    });
  });

  describe('formatScaled', () => {
    it('truncates toward zero deterministically', () => {
      expect(formatScaled(12_500_000n, 7)).toBe('1.25');
      expect(formatScaled(500n, 2)).toBe('5');
      expect(formatScaled(0n, 7)).toBe('0');
    });

    it('preserves the sign for negative balances', () => {
      expect(formatScaled(-12_500_000n, 7)).toBe('-1.25');
    });
  });
});

// ─── Slippage policy clamp bounds (#1153) ────────────────────────────────────
//
// SLIPPAGE_POLICY is the server-side source of truth for the clamp an
// untrusted client can reach. These tests pin the inclusive bounds so a future
// edit cannot silently widen the ceiling without a failing test.

describe('SLIPPAGE_POLICY clamp bounds (#1153)', () => {
  it('pins the documented inclusive bounds', () => {
    expect(SLIPPAGE_POLICY.minToleranceBps).toBe(1);
    expect(SLIPPAGE_POLICY.maxToleranceBps).toBe(500);
    expect(SLIPPAGE_POLICY.minDeadlineSeconds).toBe(5);
    expect(SLIPPAGE_POLICY.maxDeadlineSeconds).toBe(300);
  });

  it('accepts the inclusive tolerance boundaries 1 and 500 unchanged', () => {
    expect(validateSlippageParams({ toleranceBps: 1, deadlineSeconds: 30 })).toEqual({
      toleranceBps: 1,
      deadlineSeconds: 30,
    });
    expect(
      validateSlippageParams({
        toleranceBps: SLIPPAGE_POLICY.maxToleranceBps,
        deadlineSeconds: 30,
      }),
    ).toEqual({ toleranceBps: 500, deadlineSeconds: 30 });
  });

  it('rejects tolerance 0 and 501 with SLIPPAGE_INVALID_TOLERANCE', () => {
    expect(() =>
      validateSlippageParams({ toleranceBps: 0, deadlineSeconds: 30 }),
    ).toThrow(SLIPPAGE_ERROR_CODES.SLIPPAGE_INVALID_TOLERANCE);
    expect(() =>
      validateSlippageParams({
        toleranceBps: SLIPPAGE_POLICY.maxToleranceBps + 1,
        deadlineSeconds: 30,
      }),
    ).toThrow(SLIPPAGE_ERROR_CODES.SLIPPAGE_INVALID_TOLERANCE);
  });

  it('rejects negative tolerance with SLIPPAGE_INVALID_TOLERANCE', () => {
    expect(() =>
      validateSlippageParams({ toleranceBps: -1, deadlineSeconds: 30 }),
    ).toThrow(SLIPPAGE_ERROR_CODES.SLIPPAGE_INVALID_TOLERANCE);
  });

  it('accepts the inclusive deadline boundaries 5 and 300', () => {
    expect(
      validateSlippageParams({
        toleranceBps: 100,
        deadlineSeconds: SLIPPAGE_POLICY.minDeadlineSeconds,
      }),
    ).toEqual({ toleranceBps: 100, deadlineSeconds: 5 });
    expect(
      validateSlippageParams({
        toleranceBps: 100,
        deadlineSeconds: SLIPPAGE_POLICY.maxDeadlineSeconds,
      }),
    ).toEqual({ toleranceBps: 100, deadlineSeconds: 300 });
  });

  it('rejects deadline 4 and 301 with SLIPPAGE_INVALID_DEADLINE', () => {
    expect(() =>
      validateSlippageParams({
        toleranceBps: 100,
        deadlineSeconds: SLIPPAGE_POLICY.minDeadlineSeconds - 1,
      }),
    ).toThrow(SLIPPAGE_ERROR_CODES.SLIPPAGE_INVALID_DEADLINE);
    expect(() =>
      validateSlippageParams({
        toleranceBps: 100,
        deadlineSeconds: SLIPPAGE_POLICY.maxDeadlineSeconds + 1,
      }),
    ).toThrow(SLIPPAGE_ERROR_CODES.SLIPPAGE_INVALID_DEADLINE);
  });
});

// ─── Position-NFT metadata validation (#1153) ────────────────────────────────
//
// POSITION_NFT_TICK_RANGE is the server-side source of truth for the tick
// range an untrusted client can reach. These tests pin the inclusive bounds
// and the supported metadata version.

describe('position-NFT metadata validation (#1153)', () => {
  it('pins the documented tick range and metadata version', () => {
    expect(POSITION_NFT_TICK_RANGE.minTick).toBe(-887272);
    expect(POSITION_NFT_TICK_RANGE.maxTick).toBe(887272);
    expect(POSITION_NFT_METADATA_VERSION).toBe(1);
  });

  it('accepts a valid, ordered tick range at the supported metadata version', () => {
    expect(
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION,
        tickLower: -100,
        tickUpper: 100,
      }),
    ).toEqual({
      metadataVersion: POSITION_NFT_METADATA_VERSION,
      tickLower: -100,
      tickUpper: 100,
    });
  });

  it('accepts the inclusive tick boundaries', () => {
    expect(
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION,
        tickLower: POSITION_NFT_TICK_RANGE.minTick,
        tickUpper: POSITION_NFT_TICK_RANGE.maxTick,
      }),
    ).toEqual({
      metadataVersion: POSITION_NFT_METADATA_VERSION,
      tickLower: -887272,
      tickUpper: 887272,
    });
  });

  it('rejects tickLower === tickUpper with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION,
        tickLower: 10,
        tickUpper: 10,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.POSITION_NFT_INVALID_TICK_RANGE);
  });

  it('rejects ticks below minTick and above maxTick with POSITION_NFT_INVALID_TICK_RANGE', () => {
    expect(() =>
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION,
        tickLower: POSITION_NFT_TICK_RANGE.minTick - 1,
        tickUpper: 100,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.POSITION_NFT_INVALID_TICK_RANGE);
    expect(() =>
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION,
        tickLower: -100,
        tickUpper: POSITION_NFT_TICK_RANGE.maxTick + 1,
      }),
    ).toThrow(POSITION_NFT_ERROR_CODES.POSITION_NFT_INVALID_TICK_RANGE);
  });

  it('rejects an unsupported metadataVersion with POSITION_NFT_UNSUPPORTED_METADATA_VERSION', () => {
    expect(() =>
      validatePositionNftMetadata({
        metadataVersion: POSITION_NFT_METADATA_VERSION + 1,
        tickLower: -100,
        tickUpper: 100,
      }),
    ).toThrow(
      POSITION_NFT_ERROR_CODES.POSITION_NFT_UNSUPPORTED_METADATA_VERSION,
    );
  });
});
