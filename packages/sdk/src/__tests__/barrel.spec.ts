import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  EMPTY_POSITION_MESSAGE,
  SwyftRpcError,
  getPool,
  getPosition,
  getPositionWithLoading,
  getTick,
} from '../index';
import type {
  GetPoolParams,
  GetPositionParams,
  GetTickParams,
  PoolState,
  PositionState,
  TickState,
} from '../index';

describe('@swyft/sdk barrel', () => {
  it('exposes the query helpers as functions', () => {
    expect(typeof getPool).toBe('function');
    expect(typeof getPosition).toBe('function');
    expect(typeof getPositionWithLoading).toBe('function');
    expect(typeof getTick).toBe('function');
    expect(typeof EMPTY_POSITION_MESSAGE).toBe('string');
  });

  it('exposes SwyftRpcError as a constructible error class', () => {
    expect(typeof SwyftRpcError).toBe('function');

    const cause = new Error('underlying rpc failure');
    const error = new SwyftRpcError('rpc failed', { cause });

    expect(error).toBeInstanceOf(SwyftRpcError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SwyftRpcError');
    expect(error.message).toBe('rpc failed');
    expect(error.cause).toBe(cause);
  });

  it('preserves cause when constructed without options', () => {
    const error = new SwyftRpcError('rpc failed');

    expect(error.name).toBe('SwyftRpcError');
    expect(error.cause).toBeUndefined();
  });

  it('re-exports the public query types from the barrel', () => {
    expectTypeOf<PoolState>().not.toBeNever();
    expectTypeOf<PositionState>().not.toBeNever();
    expectTypeOf<TickState>().not.toBeNever();
    expectTypeOf<GetPoolParams>().not.toBeNever();
    expectTypeOf<GetPositionParams>().not.toBeNever();
    expectTypeOf<GetTickParams>().not.toBeNever();
  });
});
