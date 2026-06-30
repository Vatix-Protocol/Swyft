import {
  buildSwapTx,
  toStellarAddress,
  toRawAmount,
  toXdrBase64,
  SwapValidationError,
} from '../swap';

const POOL = toStellarAddress('CPOOL000000000000000000000000000000000000000000000000000A');
const TOKEN_IN = toStellarAddress('CTOKENIN0000000000000000000000000000000000000000000000000');
const TOKEN_OUT = toStellarAddress('CTOKENOUT000000000000000000000000000000000000000000000000');
const OWNER = toStellarAddress('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ');
const AMOUNT_IN = toRawAmount('1000000');
const MIN_OUT = toRawAmount('990000');

describe('buildSwapTx', () => {
  const validParams = {
    poolId: POOL,
    tokenInId: TOKEN_IN,
    tokenOutId: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    minimumReceived: MIN_OUT,
    ownerAddress: OWNER,
  };

  it("returns type 'swap'", () => {
    const tx = buildSwapTx(validParams);
    expect(tx.type).toBe('swap');
  });

  it('returns a valid XDR string', () => {
    const tx = buildSwapTx(validParams);
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('throws SwapValidationError for invalid poolId', () => {
    expect(() => buildSwapTx({ ...validParams, poolId: toStellarAddress('invalid') })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for invalid tokenInId', () => {
    expect(() =>
      buildSwapTx({ ...validParams, tokenInId: toStellarAddress('NOTAVALIDADDRESS') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for invalid tokenOutId', () => {
    expect(() =>
      buildSwapTx({ ...validParams, tokenOutId: toStellarAddress('NOTAVALIDADDRESS') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for invalid ownerAddress', () => {
    expect(() =>
      buildSwapTx({ ...validParams, ownerAddress: toStellarAddress('NOTAVALIDADDRESS') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for zero amountIn', () => {
    expect(() => buildSwapTx({ ...validParams, amountIn: toRawAmount('0') })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for negative amountIn', () => {
    expect(() => buildSwapTx({ ...validParams, amountIn: toRawAmount('-1000') })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for zero minimumReceived', () => {
    expect(() => buildSwapTx({ ...validParams, minimumReceived: toRawAmount('0') })).toThrow(
      SwapValidationError
    );
  });

  it('produces different XDR for different amountIn values', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, amountIn: toRawAmount('5000000') });
    expect(tx1.xdr).not.toBe(tx2.xdr);
  });

  it('produces consistent XDR hash for identical parameters', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx(validParams);
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).toBe(hash2);
  });

  it('produces different XDR hash for different poolId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, poolId: toStellarAddress('CPOOL999999999999999999999999999999999999999999999999999') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different tokenInId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, tokenInId: toStellarAddress('CTOKENIN999999999999999999999999999999999999999999999999') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different tokenOutId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, tokenOutId: toStellarAddress('CTOKENOUT9999999999999999999999999999999999999999999999') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different minimumReceived', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, minimumReceived: toRawAmount('980000') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different ownerAddress', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, ownerAddress: toStellarAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different slippageBps', () => {
    const tx1 = buildSwapTx({ ...validParams, slippageBps: 50 });
    const tx2 = buildSwapTx({ ...validParams, slippageBps: 100 });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('throws when poolId is empty', () => {
    expect(() =>
      buildSwapTx({
        poolId: toStellarAddress(''),
        tokenInId: TOKEN_IN,
        tokenOutId: TOKEN_OUT,
        amountIn: AMOUNT_IN,
        minimumReceived: MIN_OUT,
        ownerAddress: OWNER,
      })
    ).toThrow();
  });

  it('throws when tokenInId is empty', () => {
    expect(() =>
      buildSwapTx({
        poolId: POOL,
        tokenInId: toStellarAddress(''),
        tokenOutId: TOKEN_OUT,
        amountIn: AMOUNT_IN,
        minimumReceived: MIN_OUT,
        ownerAddress: OWNER,
      })
    ).toThrow();
  });

  it('throws when amountIn is empty', () => {
    expect(() =>
      buildSwapTx({
        poolId: POOL,
        tokenInId: TOKEN_IN,
        tokenOutId: TOKEN_OUT,
        amountIn: toRawAmount(''),
        minimumReceived: MIN_OUT,
        ownerAddress: OWNER,
      })
    ).toThrow();
  });

  it('accepts valid slippageBps parameter', () => {
    const tx = buildSwapTx({ ...validParams, slippageBps: 50 });
    expect(tx.type).toBe('swap');
  });

  it('throws SwapValidationError for negative slippageBps', () => {
    expect(() => buildSwapTx({ ...validParams, slippageBps: -10 })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for slippageBps > 10000', () => {
    expect(() => buildSwapTx({ ...validParams, slippageBps: 10001 })).toThrow(
      SwapValidationError
    );
  });

  it('accepts slippageBps of 0', () => {
    const tx = buildSwapTx({ ...validParams, slippageBps: 0 });
    expect(tx.type).toBe('swap');
  });

  it('accepts slippageBps of 10000 (100%)', () => {
    const tx = buildSwapTx({ ...validParams, slippageBps: 10000 });
    expect(tx.type).toBe('swap');
  });

  it('works without slippageBps parameter (defaults to undefined)', () => {
    const tx = buildSwapTx(validParams);
    expect(tx.type).toBe('swap');
  });
});

describe('cast helpers', () => {
  it('toStellarAddress returns the same string value', () => {
    const addr = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
    expect(toStellarAddress(addr)).toBe(addr);
  });

  it('toRawAmount returns the same string value', () => {
    expect(toRawAmount('9999')).toBe('9999');
  });

  it('toXdrBase64 returns the same string value', () => {
    const b64 = btoa('hello');
    expect(toXdrBase64(b64)).toBe(b64);
  });
});
