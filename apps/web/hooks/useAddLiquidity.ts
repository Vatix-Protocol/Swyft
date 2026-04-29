"use client";

import { useState, useCallback, useMemo } from "react";
import type { PoolDetail } from "./usePoolTicks";

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
  if (feeTier === "0.01%") return 1;
  if (feeTier === "0.05%") return 10;
  if (feeTier === "0.30%") return 60;
  if (feeTier === "1.00%") return 200;
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

export type TxStatus = "idle" | "signing" | "submitting" | "success" | "error";

export interface AddLiquidityState {
  pool: PoolDetail | null;
  lowerTick: number;
  upperTick: number;
  lowerPrice: string;
  upperPrice: string;
  amount0: string;
  amount1: string;
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
  lowerPrice: "",
  upperPrice: "",
  amount0: "",
  amount1: "",
  txStatus: "idle",
  txHash: null,
  txError: null,
  positionNftId: null,
  isFullRange: false,
};

export function useAddLiquidity() {
  const [state, setState] = useState<AddLiquidityState>(defaultState);

  const tickSpacing = state.pool ? feeToTickSpacing(state.pool.feeTier) : 60;

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
      amount0: "",
      amount1: "",
      isFullRange: false,
    }));
  }, []);

  const setLowerTick = useCallback((tick: number) => {
    const snapped = nearestUsableTick(tick, tickSpacing);
    setState((s) => ({ ...s, lowerTick: snapped, lowerPrice: tickToPrice(snapped).toFixed(6), isFullRange: false }));
  }, [tickSpacing]);

  const setUpperTick = useCallback((tick: number) => {
    const snapped = nearestUsableTick(tick, tickSpacing);
    setState((s) => ({ ...s, upperTick: snapped, upperPrice: tickToPrice(snapped).toFixed(6), isFullRange: false }));
  }, [tickSpacing]);

  const setLowerPrice = useCallback((price: string) => {
    setState((s) => {
      const p = parseFloat(price);
      const tick = isNaN(p) || p <= 0 ? s.lowerTick : nearestUsableTick(priceToTick(p), tickSpacing);
      return { ...s, lowerPrice: price, lowerTick: tick, isFullRange: false };
    });
  }, [tickSpacing]);

  const setUpperPrice = useCallback((price: string) => {
    setState((s) => {
      const p = parseFloat(price);
      const tick = isNaN(p) || p <= 0 ? s.upperTick : nearestUsableTick(priceToTick(p), tickSpacing);
      return { ...s, upperPrice: price, upperTick: tick, isFullRange: false };
    });
  }, [tickSpacing]);

  const setAmount0 = useCallback((val: string) => {
    setState((s) => {
      if (!s.pool) return { ...s, amount0: val };
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0) return { ...s, amount0: val, amount1: "" };
      const { amount1 } = calcAmounts(s.pool.currentPrice, tickToPrice(s.lowerTick), tickToPrice(s.upperTick), n, null);
      return { ...s, amount0: val, amount1: amount1 > 0 ? amount1.toFixed(7) : "" };
    });
  }, []);

  const setAmount1 = useCallback((val: string) => {
    setState((s) => {
      if (!s.pool) return { ...s, amount1: val };
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0) return { ...s, amount1: val, amount0: "" };
      const { amount0 } = calcAmounts(s.pool.currentPrice, tickToPrice(s.lowerTick), tickToPrice(s.upperTick), null, n);
      return { ...s, amount1: val, amount0: amount0 > 0 ? amount0.toFixed(7) : "" };
    });
  }, []);

  const setFullRange = useCallback(() => {
    setState((s) => ({
      ...s,
      lowerTick: MIN_TICK,
      upperTick: MAX_TICK,
      lowerPrice: "0.000001",
      upperPrice: "999999",
      isFullRange: true,
    }));
  }, []);

  const submit = useCallback(async (
    walletAddress: string,
    signXdr: (xdr: string) => Promise<string>
  ) => {
    setState((s) => ({ ...s, txStatus: "signing", txError: null }));
    try {
      const { pool, lowerTick, upperTick, amount0, amount1 } = state;
      if (!pool) throw new Error("No pool selected");
      const payload = JSON.stringify({ op: "mint", pool: pool.id, lowerTick, upperTick, amount0, amount1, owner: walletAddress });
      const xdr = Buffer.from(payload).toString("base64");
      setState((s) => ({ ...s, txStatus: "submitting" }));
      await signXdr(xdr);
      await new Promise((r) => setTimeout(r, 1200));
      setState((s) => ({
        ...s,
        txStatus: "success",
        txHash: `0x${Math.random().toString(16).slice(2, 18)}`,
        positionNftId: `pos-${Date.now().toString(36)}`,
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      setState((s) => ({ ...s, txStatus: "error", txError: msg.toLowerCase().includes("reject") ? "rejected" : "network" }));
    }
  }, [state]);

  const reset = useCallback(() => setState(defaultState), []);

  const preview = useMemo(() => {
    if (!state.pool) return { shareOfPool: "—", estimatedApr: "—", inRange: false };
    const lp = tickToPrice(state.lowerTick);
    const up = tickToPrice(state.upperTick);
    const cp = state.pool.currentPrice;
    const inRange = cp >= lp && cp <= up;
    const depositValue = parseFloat(state.amount0 || "0") * cp + parseFloat(state.amount1 || "0");
    const shareOfPool = state.pool.tvl > 0 ? ((depositValue / state.pool.tvl) * 100).toFixed(4) : "0.0000";
    const rangeRatio = Math.min(1, (up - lp) / cp);
    const boostedApr = rangeRatio > 0 ? (state.pool.feeApr / Math.max(0.01, rangeRatio)).toFixed(1) : state.pool.feeApr.toFixed(1);
    return { shareOfPool, estimatedApr: boostedApr, inRange };
  }, [state]);

  return { ...state, setPool, setLowerTick, setUpperTick, setLowerPrice, setUpperPrice, setAmount0, setAmount1, setFullRange, submit, reset, preview };
}
