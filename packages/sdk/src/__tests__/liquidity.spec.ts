import {
  estimateRemoveAmounts,
  estimateRemoveAmountsAsync,
  buildBurnTx,
  buildCollectTx,
  buildAddLiquidityTx,
  buildRerangeTx,
  detectPoolType,
  RemoveAmountsParams,
  ValidationError,
} from '../liquidity';

// Valid Soroban contract addresses for testing (must start with C)
const VALID_POOL_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const VALID_OWNER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

// ---------------------------------------------------------------------------
// estimateRemoveAmounts
// ---------------------------------------------------------------------------

describe('estimateRemoveAmounts', () => {
  const LIQUIDITY = '1000000';
  const TICK_LOWER = -100;
  const TICK_UPPER = 100;

  const base: RemoveAmountsParams = {
    liquidity: LIQUIDITY,
    pct: 100,
    currentPrice: 1.0,
    lowerTick: TICK_LOWER,
    upperTick: TICK_UPPER,
  };

  it('returns non-negative amounts when price is within range', () => {
    const result = estimateRemoveAmounts(base);
    expect(parseFloat(result.amount0)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(result.amount1)).toBeGreaterThanOrEqual(0);
  });

  it('returns only amount0 when price is below lower tick', () => {
    const result = estimateRemoveAmounts({ ...base, currentPrice: 0.00001 });
    expect(parseFloat(result.amount0)).toBeGreaterThan(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it('returns only amount1 when price is above upper tick', () => {
    const result = estimateRemoveAmounts({ ...base, currentPrice: 100000 });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBeGreaterThan(0);
  });

  it('scales linearly with removal percentage', () => {
    const full = estimateRemoveAmounts({ ...base, pct: 100 });
    const half = estimateRemoveAmounts({ ...base, pct: 50 });
    expect(parseFloat(full.amount0)).toBeCloseTo(parseFloat(half.amount0) * 2, 5);
    expect(parseFloat(full.amount1)).toBeCloseTo(parseFloat(half.amount1) * 2, 5);
  });

  it('returns zero amounts for 0% removal', () => {
    const result = estimateRemoveAmounts({ ...base, pct: 0 });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it('returns amounts with 7 decimal places', () => {
    const result = estimateRemoveAmounts({ ...base, pct: 50 });
    expect(result.amount0).toMatch(/^\d+\.\d{7}$/);
    expect(result.amount1).toMatch(/^\d+\.\d{7}$/);
  });

  it('handles zero liquidity without throwing', () => {
    const result = estimateRemoveAmounts({ ...base, liquidity: '0' });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it('throws RangeError when pct is below 0', () => {
    expect(() => estimateRemoveAmounts({ ...base, pct: -1 })).toThrow(RangeError);
  });

  it('throws RangeError when pct is above 100', () => {
    expect(() => estimateRemoveAmounts({ ...base, pct: 101 })).toThrow(RangeError);
  });

  it('throws RangeError for non-finite liquidity', () => {
    expect(() => estimateRemoveAmounts({ ...base, liquidity: 'NaN' })).toThrow(RangeError);
  });

  it('throws RangeError for Infinity liquidity string', () => {
    expect(() => estimateRemoveAmounts({ ...base, liquidity: 'Infinity' })).toThrow(RangeError);
  });

  it('scales proportionally with liquidity amount', () => {
    const single = estimateRemoveAmounts(base);
    const triple = estimateRemoveAmounts({ ...base, liquidity: '3000000' });
    expect(parseFloat(triple.amount0)).toBeCloseTo(parseFloat(single.amount0) * 3, 5);
    expect(parseFloat(triple.amount1)).toBeCloseTo(parseFloat(single.amount1) * 3, 5);
  });
});

// ---------------------------------------------------------------------------
// estimateRemoveAmountsAsync
// ---------------------------------------------------------------------------

describe('estimateRemoveAmountsAsync', () => {
  const params: RemoveAmountsParams = {
    liquidity: '500000',
    pct: 75,
    currentPrice: 1.0,
    lowerTick: -200,
    upperTick: 200,
  };

  it('resolves to the same result as the sync version', async () => {
    const sync = estimateRemoveAmounts(params);
    const async_ = await estimateRemoveAmountsAsync(params);
    expect(async_).toEqual(sync);
  });

  it('returns a Promise', () => {
    const result = estimateRemoveAmountsAsync({
      liquidity: '1000000',
      pct: 100,
      currentPrice: 1.0,
      lowerTick: -100,
      upperTick: 100,
    });
    expect(result).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// buildBurnTx
// ---------------------------------------------------------------------------

describe('buildBurnTx', () => {
  it('returns a base64 XDR string and type burn', () => {
    const tx = buildBurnTx({
      positionId: '1',
      poolId: VALID_POOL_ID,
      liquidity: '1000000',
      liquidityBps: 5000,
      ownerAddress: VALID_OWNER,
    });
    expect(tx.type).toBe('burn');
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('throws when liquidityBps is out of range', () => {
    expect(() =>
      buildBurnTx({
        positionId: '1',
        poolId: VALID_POOL_ID,
        liquidity: '1000000',
        liquidityBps: 10001,
        ownerAddress: VALID_OWNER,
      })
    ).toThrow();
  });

  it('throws when positionId is empty', () => {
    expect(() =>
      buildBurnTx({
        positionId: '',
        poolId: VALID_POOL_ID,
        liquidity: '1000000',
        liquidityBps: 5000,
        ownerAddress: VALID_OWNER,
      })
    ).toThrow();
  });

  it('supports cl_pool poolType', () => {
    const tx = buildBurnTx({
      positionId: '1',
      poolId: VALID_POOL_ID,
      liquidity: '1000000',
      liquidityBps: 5000,
      ownerAddress: VALID_OWNER,
      poolType: 'cl_pool',
    });
    expect(tx.type).toBe('burn');
    expect(tx.xdr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildCollectTx
// ---------------------------------------------------------------------------

describe('buildCollectTx', () => {
  it('returns a base64 XDR string and type collect with valid ownerWallet', () => {
    const tx = buildCollectTx({
      positionId: '1',
      poolId: VALID_POOL_ID,
      ownerAddress: VALID_OWNER,
      ownerWallet: VALID_OWNER,
    });
    expect(tx.type).toBe('collect');
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('throws ValidationError when ownerWallet is missing', () => {
    expect(() =>
      buildCollectTx({
        positionId: '1',
        poolId: VALID_POOL_ID,
        ownerAddress: VALID_OWNER,
        ownerWallet: '',
      })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when ownerWallet is not a valid Stellar address', () => {
    expect(() =>
      buildCollectTx({
        positionId: '1',
        poolId: VALID_POOL_ID,
        ownerAddress: VALID_OWNER,
        ownerWallet: 'invalid-address',
      })
    ).toThrow(ValidationError);
  });

  it('supports cl_pool poolType', () => {
    const tx = buildCollectTx({
      positionId: '1',
      poolId: VALID_POOL_ID,
      ownerAddress: VALID_OWNER,
      ownerWallet: VALID_OWNER,
      poolType: 'cl_pool',
    });
    expect(tx.type).toBe('collect');
    expect(tx.xdr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildAddLiquidityTx
// ---------------------------------------------------------------------------

describe('buildAddLiquidityTx', () => {
  it('returns a base64 XDR string and type add_liquidity', () => {
    const tx = buildAddLiquidityTx({
      poolId: VALID_POOL_ID,
      ownerAddress: VALID_OWNER,
      lowerTick: -1000,
      upperTick: 1000,
      liquidity: '1000000',
    });
    expect(tx.type).toBe('add_liquidity');
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('throws when lowerTick >= upperTick', () => {
    expect(() =>
      buildAddLiquidityTx({
        poolId: VALID_POOL_ID,
        ownerAddress: VALID_OWNER,
        lowerTick: 1000,
        upperTick: 1000,
        liquidity: '1000000',
      })
    ).toThrow(ValidationError);
  });

  it('throws when liquidity is zero', () => {
    expect(() =>
      buildAddLiquidityTx({
        poolId: VALID_POOL_ID,
        ownerAddress: VALID_OWNER,
        lowerTick: -1000,
        upperTick: 1000,
        liquidity: '0',
      })
    ).toThrow(ValidationError);
  });

  it('supports cl_pool poolType', () => {
    const tx = buildAddLiquidityTx({
      poolId: VALID_POOL_ID,
      ownerAddress: VALID_OWNER,
      lowerTick: -1000,
      upperTick: 1000,
      liquidity: '1000000',
      poolType: 'cl_pool',
    });
    expect(tx.type).toBe('add_liquidity');
    expect(tx.xdr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildRerangeTx
// ---------------------------------------------------------------------------

describe('buildRerangeTx', () => {
  it('returns a base64 XDR string and type rerange', () => {
    const tx = buildRerangeTx({
      poolId: VALID_POOL_ID,
      positionId: '1',
      ownerAddress: VALID_OWNER,
      liquidity: '1000000',
      newLowerTick: -2000,
      newUpperTick: 2000,
    });
    expect(tx.type).toBe('rerange');
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('throws when newLowerTick >= newUpperTick', () => {
    expect(() =>
      buildRerangeTx({
        poolId: VALID_POOL_ID,
        positionId: '1',
        ownerAddress: VALID_OWNER,
        liquidity: '1000000',
        newLowerTick: 2000,
        newUpperTick: 2000,
      })
    ).toThrow(ValidationError);
  });

  it('throws when liquidity is zero', () => {
    expect(() =>
      buildRerangeTx({
        poolId: VALID_POOL_ID,
        positionId: '1',
        ownerAddress: VALID_OWNER,
        liquidity: '0',
        newLowerTick: -2000,
        newUpperTick: 2000,
      })
    ).toThrow(ValidationError);
  });

  it('supports cl_pool poolType', () => {
    const tx = buildRerangeTx({
      poolId: VALID_POOL_ID,
      positionId: '1',
      ownerAddress: VALID_OWNER,
      liquidity: '1000000',
      newLowerTick: -2000,
      newUpperTick: 2000,
      poolType: 'cl_pool',
    });
    expect(tx.type).toBe('rerange');
    expect(tx.xdr.length).toBeGreaterThan(0);
  });
});
