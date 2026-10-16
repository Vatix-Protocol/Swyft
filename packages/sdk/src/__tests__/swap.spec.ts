import { TransactionBuilder, Networks, scValToNative, Transaction } from '@stellar/stellar-sdk';
import {
  buildSwapTx,
  toStellarAddress,
  toRawAmount,
  toXdrBase64,
  SwapValidationError,
  DEFAULT_SWAP_DEADLINE_SECONDS,
  MAX_SWAP_DEADLINE_SECONDS,
  buildExactOutputSwapTx,
} from '../swap';

const POOL = toStellarAddress('CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526');
const TOKEN_IN = toStellarAddress('CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3');
const TOKEN_OUT = toStellarAddress('CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U');
const OWNER = toStellarAddress('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ');
const SOURCE_ACCOUNT = toStellarAddress('GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI');
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

  it('produces identical XDR for identical params when sourceAccount is supplied', () => {
    const tx1 = buildSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    const tx2 = buildSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    expect(tx1.xdr).toBe(tx2.xdr);
  });

  it('produces different XDR for different amountIn when sourceAccount is supplied', () => {
    const tx1 = buildSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    const tx2 = buildSwapTx({
      ...validParams,
      amountIn: toRawAmount('5000000'),
      sourceAccount: SOURCE_ACCOUNT,
    });
    expect(tx1.xdr).not.toBe(tx2.xdr);
  });

  it('produces different XDR hash for different poolId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, poolId: toStellarAddress('CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different tokenInId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, tokenInId: toStellarAddress('CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW') });
    const hash1 = Buffer.from(tx1.xdr, 'base64').toString('hex');
    const hash2 = Buffer.from(tx2.xdr, 'base64').toString('hex');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different XDR hash for different tokenOutId', () => {
    const tx1 = buildSwapTx(validParams);
    const tx2 = buildSwapTx({ ...validParams, tokenOutId: toStellarAddress('CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST') });
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
    const tx2 = buildSwapTx({ ...validParams, ownerAddress: toStellarAddress('GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI') });
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

describe('deadline', () => {
  const validParams = {
    poolId: POOL,
    tokenInId: TOKEN_IN,
    tokenOutId: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    minimumReceived: MIN_OUT,
    ownerAddress: OWNER,
  };

  it('uses DEFAULT_SWAP_DEADLINE_SECONDS when deadline is not provided', () => {
    const tx = buildSwapTx(validParams);
    const parsed = TransactionBuilder.fromXDR(tx.xdr, Networks.TESTNET);
    expect(parsed).toBeInstanceOf(Transaction);
    const txObj = parsed as Transaction;
    const now = Math.floor(Date.now() / 1000);
    expect(txObj.timeBounds?.maxTime).toBeDefined();
    const maxTime = Number(txObj.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThanOrEqual(now + DEFAULT_SWAP_DEADLINE_SECONDS - 5);
    expect(maxTime).toBeLessThanOrEqual(now + DEFAULT_SWAP_DEADLINE_SECONDS + 5);
  });

  it('uses provided deadlineSeconds', () => {
    const tx = buildSwapTx({ ...validParams, deadlineSeconds: 120 });
    const parsed = TransactionBuilder.fromXDR(tx.xdr, Networks.TESTNET) as Transaction;
    const now = Math.floor(Date.now() / 1000);
    const maxTime = Number(parsed.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThanOrEqual(now + 120 - 5);
    expect(maxTime).toBeLessThanOrEqual(now + 120 + 5);
  });

  it('throws SwapValidationError for deadlineSeconds of 0', () => {
    expect(() => buildSwapTx({ ...validParams, deadlineSeconds: 0 })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for negative deadlineSeconds', () => {
    expect(() => buildSwapTx({ ...validParams, deadlineSeconds: -1 })).toThrow(
      SwapValidationError
    );
  });

  it('throws SwapValidationError for deadlineSeconds exceeding MAX_SWAP_DEADLINE_SECONDS', () => {
    expect(() =>
      buildSwapTx({ ...validParams, deadlineSeconds: MAX_SWAP_DEADLINE_SECONDS + 1 })
    ).toThrow(SwapValidationError);
  });

  it('accepts deadlineSeconds equal to MAX_SWAP_DEADLINE_SECONDS', () => {
    const tx = buildSwapTx({ ...validParams, deadlineSeconds: MAX_SWAP_DEADLINE_SECONDS });
    expect(tx.type).toBe('swap');
  });
});

describe('buildExactOutputSwapTx', () => {
  const validParams = {
    poolId: POOL,
    tokenInId: TOKEN_IN,
    tokenOutId: TOKEN_OUT,
    amountOut: toRawAmount('1000000'),
    maximumIn: toRawAmount('1010000'),
    ownerAddress: OWNER,
  };

  it("returns type 'swap'", () => {
    const tx = buildExactOutputSwapTx(validParams);
    expect(tx.type).toBe('swap');
  });

  it('returns a valid XDR string', () => {
    const tx = buildExactOutputSwapTx(validParams);
    expect(typeof tx.xdr).toBe('string');
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, 'base64')).not.toThrow();
  });

  it('produces identical XDR for identical params when sourceAccount is supplied', () => {
    const tx1 = buildExactOutputSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    const tx2 = buildExactOutputSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    expect(tx1.xdr).toBe(tx2.xdr);
  });

  it('produces different XDR for different amountOut when sourceAccount is supplied', () => {
    const tx1 = buildExactOutputSwapTx({ ...validParams, sourceAccount: SOURCE_ACCOUNT });
    const tx2 = buildExactOutputSwapTx({
      ...validParams,
      amountOut: toRawAmount('2000000'),
      sourceAccount: SOURCE_ACCOUNT,
    });
    expect(tx1.xdr).not.toBe(tx2.xdr);
  });

  it('throws SwapValidationError for zero amountOut', () => {
    expect(() =>
      buildExactOutputSwapTx({ ...validParams, amountOut: toRawAmount('0') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for zero maximumIn', () => {
    expect(() =>
      buildExactOutputSwapTx({ ...validParams, maximumIn: toRawAmount('0') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for invalid poolId', () => {
    expect(() =>
      buildExactOutputSwapTx({ ...validParams, poolId: toStellarAddress('invalid') })
    ).toThrow(SwapValidationError);
  });

  it('throws SwapValidationError for invalid ownerAddress', () => {
    expect(() =>
      buildExactOutputSwapTx({ ...validParams, ownerAddress: toStellarAddress('NOTAVALIDADDRESS') })
    ).toThrow(SwapValidationError);
  });
});
