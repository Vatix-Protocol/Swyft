"use client";

import { useState, useEffect, useCallback } from "react";
import type { PositionSnapshot } from "@swyft/ui";
import { API_BASE } from "@/lib/constants";

async function fetchPositions(
  authToken: string,
  status: "active" | "closed"
): Promise<PositionSnapshot[]> {
  const res = await fetch(`${API_BASE}/positions?status=${status}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: PositionSnapshot[] };
  return data.items ?? [];
}

export function usePortfolio(authToken: string | null) {
  const [active, setActive] = useState<PositionSnapshot[]>([]);
  const [closed, setClosed] = useState<PositionSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!authToken) {
      setActive([]);
      setClosed([]);
      return;
    }
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        fetchPositions(authToken, "active"),
        fetchPositions(authToken, "closed"),
      ]);
      setActive(a);
      setClosed(c);
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    refresh();
    if (!authToken) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [authToken, refresh]);

  const totalValueUsd = active.reduce((sum, p) => sum + p.currentValueUsd, 0);

  return { active, closed, loading, refresh, totalValueUsd };
}
