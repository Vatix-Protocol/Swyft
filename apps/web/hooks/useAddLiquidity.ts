'use client';

import { useState, useCallback, useMemo } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { buildAddLiquidityTx } from '@swyft/sdk';
import type { PoolDetail } from './usePoolTicks';
import { API_BASE, getNetworkPassphrase } from '@/lib/constants';
import { useNetworkContext } from '@/context/NetworkContext';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

export function tickToPrice(tick: number): number {
  return Math.pow(TICK_BASE, tick);
}

export function priceToTick(price: number): number {
  return Math.round(Math.log(price) / Math.log(TICK_BASE));
}

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, rounded));
}

function feeToTickSpacing(feeTier: string): number {
  if (feeTier === '0.01%') return 1;
  if (feeTier === '0.05%') return 10;
  if (feeTier === '0.30%') return 60;
  if (feeTier === '1.00%') return 200;
  return 60;
}

function calcAmounts(
  currentPrice: number,
  lowerPrice: number,
  upperPrice: number,
  targetAmount0: number | null,
  targetAmount1: number | null
): { amount0: number; amount1: number } {
  const sqrtP = Math.sqrt(currentPrice);
  const sqrtL = Math.sqrt(lowerPrice);
  const sqrtU = Math.sqrt(upperPrice);

  if (sqrtP <= sqrtL) {
    const liq = targetAmount0 != null ? (targetAmount0 * sqrtL * sqrtU) / (sqrtU - sqrtL) : 0;
    return { amount0: targetAmount0 ?? (liq * (sqrtU - sqrtL)) / (sqrtL * sqrtU), amount1: 0 };
  }

  if (sqrtP >= sqrtU) {
    const liq = targetAmount1 != null ? targetAmount1 / (sqrtU - sqrtL) : 0;
    return { amount0: 0, amount1: targetAmount1 ?? liq * (sqrtU - sqrtL) };
  }

  if (targetAmount0 != null) {
    const liq = (targetAmount0 * sqrtP * sqrtU) / (sqrtU - sqrtP);
    return { amount0: targetAmount0, amount1: liq * (sqrtP - sqrtL) };
  } else if (targetAmount1 != null) {
    const liq = targetAmount1 / (sqrtP - sqrtL);
    return { amount0: (liq * (sqrtU - sqrtP)) / (sqrtP * sqrtU), amount1: targetAmount1 };
  }

  return { amount0: 0, amount1: 0 };
}

export type TxStatus = 'idle' | 'signing' | 'submitting' | 'success' | 'error';

export interface AddLiquidityState {
  pool: PoolDetail | null;
  lowerTick: number;
  upperTick: number;
  lowerPrice: string;
  upperPrice: string;
  amount0: string;
  amount1: string;
  /** Which amount field was last edited by the user — used to decide which
   *  amount to recalculate when the range changes. */
  lastEditedAmount: 'amount0' | 'amount1' | null;
  txStatus: TxStatus;
  txHash: string | null;
  txError: string | null;
  positionNftId: string | null;
  isFullRange: boolean;
}

const defaultState: AddLiquidityState = {
  pool: null,
  lowerTick: -1000,
  upperTick: 1000,
  lowerPrice: '',
  upperPrice: '',
  amount0: '',
  amount1: '',
  lastEditedAmount: null,
  txStatus: 'idle',
  txHash: null,
  txError: null,
  positionNftId: null,
  isFullRange: false,
};

export function useAddLiquidity() {
  const [state, setState] = useState<AddLiquidityState>(defaultState);
  const { network } = useNetworkContext();

  const tickSpacing = state.pool ? feeToTickSpacing(state.pool.feeTier) : 60;

  /**
   * Recalculate the dependent amount after a range change. Uses
   * `lastEditedAmount` to decide which amount the user considers the
   * anchor so we only recalculate the other one.
   */
  function syncAmountsForRange(
    s: AddLiquidityState,
    newLowerTick: number,
    newUpperTick: number,
  ): Pick<AddLiquidityState, 'amount0' | 'amount1'> {
    if (!s.pool) return { amount0: s.amount0, amount1: s.amount1 };
    const lp = tickToPrice(newLowerTick);
    const up = tickToPrice(newUpperTick);

    if (s.lastEditedAmount === 'amount0') {
      const n0 = parseFloat(s.amount0);
      if (isNaN(n0) || n0 <= 0) return { amount0: s.amount0, amount1: s.amount1 };
      const { amount1 } = calcAmounts(s.pool.currentPrice, lp, up, n0, null);
      return { amount0: s.amount0, amount1: amount1 > 0 ? amount1.toFixed(7) : '' };
    }
    if (s.lastEditedAmount === 'amount1') {
      const n1 = parseFloat(s.amount1);
      if (isNaN(n1) || n1 <= 0) return { amount0: s.amount0, amount1: s.amount1 };
      const { amount0 } = calcAmounts(s.pool.currentPrice, lp, up, null, n1);
      return { amount0: amount0 > 0 ? amount0.toFixed(7) : '', amount1: s.amount1 };
    }
    return { amount0: s.amount0, amount1: s.amount1 };
  }

  const setPool = useCallback((pool: PoolDetail) => {
    const spacing = feeToTickSpacing(pool.feeTier);
    const currentTick = pool.currentTick ?? priceToTick(pool.currentPrice);
    const lowerTick = nearestUsableTick(currentTick - spacing * 10, spacing);
    const upperTick = nearestUsableTick(currentTick + spacing * 10, spacing);
    setState((s) => ({
      ...s,
      pool,
      lowerTick,
      upperTick,
      lowerPrice: tickToPrice(lowerTick).toFixed(6),
      upperPrice: tickToPrice(upperTick).toFixed(6),
      amount0: '',
      amount1: '',
      isFullRange: false,
    }));
  }, []);

  const setLowerTick = useCallback(
    (tick: number) => {
      const snapped = nearestUsableTick(tick, tickSpacing);
      setState((s) => ({
        ...s,
        lowerTick: snapped,
        lowerPrice: tickToPrice(snapped).toFixed(6),
        isFullRange: false,
        ...syncAmountsForRange(s, snapped, s.upperTick),
      }));
    },
    [tickSpacing]
  );

  const setUpperTick = useCallback(
    (tick: number) => {
      const snapped = nearestUsableTick(tick, tickSpacing);
      setState((s) => ({
        ...s,
        upperTick: snapped,
        upperPrice: tickToPrice(snapped).toFixed(6),
        isFullRange: false,
        ...syncAmountsForRange(s, s.lowerTick, snapped),
      }));
    },
    [tickSpacing]
  );

  const setLowerPrice = useCallback(
    (price: string) => {
      setState((s) => {
        const p = parseFloat(price);
        const tick =
          isNaN(p) || p <= 0 ? s.lowerTick : nearestUsableTick(priceToTick(p), tickSpacing);
        return {
          ...s,
          lowerPrice: price,
          lowerTick: tick,
          isFullRange: false,
          ...syncAmountsForRange(s, tick, s.upperTick),
        };
      });
    },
    [tickSpacing]
  );

  const setUpperPrice = useCallback(
    (price: string) => {
      setState((s) => {
        const p = parseFloat(price);
        const tick =
          isNaN(p) || p <= 0 ? s.upperTick : nearestUsableTick(priceToTick(p), tickSpacing);
        return {
          ...s,
          upperPrice: price,
          upperTick: tick,
          isFullRange: false,
          ...syncAmountsForRange(s, s.lowerTick, tick),
        };
      });
    },
    [tickSpacing]
  );

  const setAmount0 = useCallback((val: string) => {
    setState((s) => {
      if (!s.pool) return { ...s, amount0: val, lastEditedAmount: 'amount0' };
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0) return { ...s, amount0: val, amount1: '', lastEditedAmount: 'amount0' };
      const { amount1 } = calcAmounts(
        s.pool.currentPrice,
        tickToPrice(s.lowerTick),
        tickToPrice(s.upperTick),
        n,
        null
      );
      return { ...s, amount0: val, amount1: amount1 > 0 ? amount1.toFixed(7) : '', lastEditedAmount: 'amount0' };
    });
  }, []);

  const setAmount1 = useCallback((val: string) => {
    setState((s) => {
      if (!s.pool) return { ...s, amount1: val, lastEditedAmount: 'amount1' };
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0) return { ...s, amount1: val, amount0: '', lastEditedAmount: 'amount1' };
      const { amount0 } = calcAmounts(
        s.pool.currentPrice,
        tickToPrice(s.lowerTick),
        tickToPrice(s.upperTick),
        null,
        n
      );
      return { ...s, amount1: val, amount0: amount0 > 0 ? amount0.toFixed(7) : '', lastEditedAmount: 'amount1' };
    });
  }, []);

  const setFullRange = useCallback(() => {
    setState((s) => {
      const newLower = MIN_TICK;
      const newUpper = MAX_TICK;
      return {
        ...s,
        lowerTick: newLower,
        upperTick: newUpper,
        lowerPrice: '0.000001',
        upperPrice: '999999',
        isFullRange: true,
        ...syncAmountsForRange(s, newLower, newUpper),
      };
    });
  }, []);

  const submit = useCallback(
    async (walletAddress: string, signXdr: (xdr: string) => Promise<string>) => {
      setState((s) => ({ ...s, txStatus: 'signing', txError: null }));
      try {
        const { pool, lowerTick, upperTick, amount0, amount1 } = state;
        if (!pool) throw new Error('No pool selected');

        // Calculate liquidity units from token amounts (simplified: use amount0 as proxy)
        const liquidityAmount = parseFloat(amount0 || '0') > 0
          ? Math.floor(parseFloat(amount0) * 1e7).toString()
          : Math.floor(parseFloat(amount1 || '0') * 1e7).toString();

        if (!liquidityAmount || liquidityAmount === '0') {
          throw new Error('Enter an amount to add');
        }

        const { xdr } = buildAddLiquidityTx({
          poolId: pool.id,
          ownerAddress: walletAddress,
          lowerTick,
          upperTick,
          liquidity: liquidityAmount,
        });

        setState((s) => ({ ...s, txStatus: 'submitting' }));

        const signResult = await signTransaction(xdr, {
          networkPassphrase: getNetworkPassphrase(network),
        });
        const signedXdr =
          typeof signResult === 'string'
            ? signResult
            : 'signedTxXdr' in signResult
              ? (signResult as { signedTxXdr: string }).signedTxXdr
              : null;

        if (!signedXdr) {
          setState((s) => ({ ...s, txStatus: 'error', txError: 'rejected' }));
          return;
        }

        const res = await fetch(`${API_BASE}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('swyft_auth_token') || ''}` },
          body: JSON.stringify({ xdr: signedXdr }),
        });

        if (!res.ok) {
          throw new Error('network');
        }

        const data = (await res.json()) as { hash: string };
        setState((s) => ({
          ...s,
          txStatus: 'success',
          // Real Horizon-confirmed transaction hash — never fabricated.
          txHash: data.hash,
          // The `/transactions` endpoint only echoes back `{ hash }`; it does
          // not (yet) surface the Soroban contract's return value or events,
          // so there is no genuine position NFT id available here. This used
          // to be a fabricated `pos-<timestamp>` placeholder — do not
          // reintroduce that. Leave it `null` until the API/indexer surfaces
          // the real id (e.g. by decoding the mint/add_liquidity return value
          // or looking the new position up once indexed).
          positionNftId: null,
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown';
        setState((s) => ({
          ...s,
          txStatus: 'error',
          txError: msg.toLowerCase().includes('reject') ? 'rejected' : 'network',
        }));
      }
    },
    [state, network]
  );

  const reset = useCallback(() => setState(defaultState), []);

  const preview = useMemo(() => {
    if (!state.pool) return { shareOfPool: '—', estimatedApr: '—', inRange: false };
    const lp = tickToPrice(state.lowerTick);
    const up = tickToPrice(state.upperTick);
    const cp = state.pool.currentPrice;
    const inRange = cp >= lp && cp <= up;
    const depositValue = parseFloat(state.amount0 || '0') * cp + parseFloat(state.amount1 || '0');
    const shareOfPool =
      state.pool.tvl > 0 ? ((depositValue / state.pool.tvl) * 100).toFixed(4) : '0.0000';

    // Fee APR assumptions live in docs/FEE_APR_CALCULATION.md: the boosted
    // APR extrapolates from the pool's trailing-24h fee/TVL ratio. Without a
    // volume24h reading there's no fee data to extrapolate from (distinct
    // from a *confirmed* zero-volume pool, which the backend already prices
    // at a real 0% per that doc), so we surface "N/A" rather than a
    // misleading number.
    const hasVolumeData =
      typeof state.pool.volume24h === 'number' && !Number.isNaN(state.pool.volume24h);
    const hasFeeAprData =
      typeof state.pool.feeApr === 'number' && !Number.isNaN(state.pool.feeApr);

    let estimatedApr: string;
    if (!hasVolumeData || !hasFeeAprData) {
      estimatedApr = 'N/A';
    } else {
      const rangeRatio = Math.min(1, (up - lp) / cp);
      estimatedApr =
        rangeRatio > 0
          ? (state.pool.feeApr / Math.max(0.01, rangeRatio)).toFixed(1)
          : state.pool.feeApr.toFixed(1);
    }

    return { shareOfPool, estimatedApr, inRange };
  }, [state]);

  return {
    ...state,
    setPool,
    setLowerTick,
    setUpperTick,
    setLowerPrice,
    setUpperPrice,
    setAmount0,
    setAmount1,
    setFullRange,
    submit,
    reset,
    preview,
  };
}
