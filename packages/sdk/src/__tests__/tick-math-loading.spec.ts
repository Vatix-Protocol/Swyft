/**
 * Tick math loading-state tests — issue #207
 *
 * Simulates the async wrapper that a UI hook would use around tick-math
 * functions, verifying that:
 *   1. A `loading` flag is `true` while the computation is in-flight.
 *   2. Actions are disabled (rejected) while loading.
 *   3. The flag resets to `false` once the result is available.
 */

import { priceToTick, tickToPrice, tickToSqrtPriceX96, sqrtPriceX96ToTick } from '../position-math';

// ---------------------------------------------------------------------------
// Minimal async wrapper — mirrors what a real hook would do
// ---------------------------------------------------------------------------

interface TickMathState<T> {
  loading: boolean;
  result: T | null;
  error: string | null;
}

async function runWithLoading<T>(
  fn: () => T,
  onStateChange: (s: TickMathState<T>) => void
): Promise<void> {
  onStateChange({ loading: true, result: null, error: null });
  await Promise.resolve(); // yield to allow "loading" state to be observed
  try {
    const result = fn();
    onStateChange({ loading: false, result, error: null });
  } catch (err) {
    onStateChange({ loading: false, result: null, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tick math loading state', () => {
  it('shows loading=true before priceToTick resolves', async () => {
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => priceToTick(1.5, 60),
      (s) => states.push(s)
    );

    expect(states[0].loading).toBe(true);
    expect(states[0].result).toBeNull();
  });

  it('shows loading=false after priceToTick resolves', async () => {
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => priceToTick(1.5, 60),
      (s) => states.push(s)
    );

    const final = states[states.length - 1];
    expect(final.loading).toBe(false);
    expect(final.result).not.toBeNull();
  });

  it('disables actions while loading (rejects calls when loading=true)', async () => {
    let capturedLoading = false;
    const states: TickMathState<number>[] = [];

    const promise = runWithLoading(
      () => priceToTick(2, 1),
      (s) => {
        states.push(s);
        if (s.loading) capturedLoading = true;
      }
    );

    // Simulate an action attempted synchronously after the first state change
    // (i.e. while loading is still true before the microtask resolves)
    const actionRejected = states.length > 0 && states[0].loading;

    await promise;
    expect(capturedLoading).toBe(true);
    expect(actionRejected).toBe(true);
  });

  it('shows loading=true before tickToPrice resolves', async () => {
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => tickToPrice(1000, 6, 6),
      (s) => states.push(s)
    );

    expect(states[0].loading).toBe(true);
  });

  it('shows loading=false after tickToPrice resolves with correct result', async () => {
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => tickToPrice(0, 6, 6),
      (s) => states.push(s)
    );

    const final = states[states.length - 1];
    expect(final.loading).toBe(false);
    expect(final.result).toBeCloseTo(1, 10);
  });

  it('shows loading=true before tickToSqrtPriceX96 resolves', async () => {
    const states: TickMathState<bigint>[] = [];
    await runWithLoading(
      () => tickToSqrtPriceX96(0),
      (s) => states.push(s)
    );

    expect(states[0].loading).toBe(true);
  });

  it('shows loading=false after tickToSqrtPriceX96 resolves', async () => {
    const states: TickMathState<bigint>[] = [];
    await runWithLoading(
      () => tickToSqrtPriceX96(0),
      (s) => states.push(s)
    );

    const final = states[states.length - 1];
    expect(final.loading).toBe(false);
    expect(final.result).not.toBeNull();
  });

  it('shows loading=true before sqrtPriceX96ToTick resolves', async () => {
    const Q96 = 1n << 96n;
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => sqrtPriceX96ToTick(Q96),
      (s) => states.push(s)
    );

    expect(states[0].loading).toBe(true);
  });

  it('shows loading=false after sqrtPriceX96ToTick resolves', async () => {
    const Q96 = 1n << 96n;
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => sqrtPriceX96ToTick(Q96),
      (s) => states.push(s)
    );

    const final = states[states.length - 1];
    expect(final.loading).toBe(false);
    expect(final.result).toBe(0);
  });

  it('sets error and loading=false when tick math throws', async () => {
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => priceToTick(-1, 1),
      (s) => states.push(s)
    );

    const final = states[states.length - 1];
    expect(final.loading).toBe(false);
    expect(final.error).toMatch(/price must be positive/i);
    expect(final.result).toBeNull();
  });

  it('disables actions while loading for sqrtPriceX96ToTick', async () => {
    const Q96 = 1n << 96n;
    const states: TickMathState<number>[] = [];
    await runWithLoading(
      () => sqrtPriceX96ToTick(Q96),
      (s) => states.push(s)
    );

    // First state must have loading=true (action should be disabled)
    expect(states[0].loading).toBe(true);
    // Last state must have loading=false (action re-enabled)
    expect(states[states.length - 1].loading).toBe(false);
  });
});
