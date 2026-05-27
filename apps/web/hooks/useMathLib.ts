"use client";

import { useState } from "react";
import { SwyftRpcError } from "@swyft/sdk";
import { API_BASE } from "@/lib/constants";

export interface MathLibResult {
  tick?: number;
  sqrtPrice?: string;
  error?: string;
}

/**
 * Hook for calling math-lib contract helpers.
 * Exposes `isLoading` so callers can show a spinner and disable actions
 * while a computation is in flight.
 */
export function useMathLib() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MathLibResult | null>(null);

  async function sqrtPriceToTick(sqrtPriceX96: string): Promise<number | null> {
    setIsLoading(true);
    setResult(null);
    try {
      const res = await fetch(
        `${API_BASE}/math/sqrt-price-to-tick?sqrtPriceX96=${encodeURIComponent(sqrtPriceX96)}`,
      );
      if (!res.ok) throw new SwyftRpcError(`math-lib request failed: ${res.status}`);
      const data = (await res.json()) as { tick: number };
      setResult({ tick: data.tick });
      return data.tick;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setResult({ error: message });
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function tickToSqrtPrice(tick: number): Promise<string | null> {
    setIsLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/math/tick-to-sqrt-price?tick=${tick}`);
      if (!res.ok) throw new SwyftRpcError(`math-lib request failed: ${res.status}`);
      const data = (await res.json()) as { sqrtPriceX96: string };
      setResult({ sqrtPrice: data.sqrtPriceX96 });
      return data.sqrtPriceX96;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setResult({ error: message });
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return { isLoading, result, sqrtPriceToTick, tickToSqrtPrice };
}
