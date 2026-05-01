"use client";

import { useEffect, useRef, useState } from "react";
import { calculateSwapQuote, type SwapQuote } from "@swyft/sdk";
import { API_BASE } from "@/lib/constants";

const WS_BASE = API_BASE.replace(/^http/, "ws");
const DEBOUNCE_MS = 350;

interface Params {
  poolId: string | null;
  tokenInId: string | null;
  tokenOutId: string | null;
  amountIn: string;
  slippageBps: number;
}

export function useSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps }: Params) {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recalculate quote whenever inputs change (debounced)
  useEffect(() => {
    if (!poolId || !tokenInId || !tokenOutId || !amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const result = calculateSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps });
      setQuote(result);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [poolId, tokenInId, tokenOutId, amountIn, slippageBps]);

  // WebSocket: re-run quote on live price events for this pool
  useEffect(() => {
    if (!poolId || !tokenInId || !tokenOutId) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_BASE}/price`);
    } catch {
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: "subscribe", poolId }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { poolId?: string };
        if (msg.poolId !== poolId) return;
        if (!amountIn || parseFloat(amountIn) <= 0) return;
        const result = calculateSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps });
        setQuote(result);
      } catch {
        // ignore malformed messages
      }
    };

    return () => { ws.close(); };
  }, [poolId, tokenInId, tokenOutId, amountIn, slippageBps]);

  return { quote, loading };
}
