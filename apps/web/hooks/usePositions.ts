"use client";

import { useEffect, useState } from "react";
import type { PositionSnapshot } from "@swyft/ui";
import { API_BASE } from "@/lib/constants";

export function usePosition(id: string | null, authToken: string | null) {
  const [position, setPosition] = useState<PositionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !authToken) { setPosition(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/positions/${id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Position not found" : "Failed to load position");
        return r.json() as Promise<PositionSnapshot>;
      })
      .then((data) => { if (!cancelled) setPosition(data); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, authToken]);

  return { position, loading, error };
}

export function usePositions(authToken: string | null) {
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authToken) { setPositions([]); return; }
    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/positions?status=active`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((data: { items?: PositionSnapshot[] }) => {
        if (!cancelled) setPositions(data.items ?? []);
      })
      .catch(() => { if (!cancelled) setPositions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [authToken]);

  return { positions, loading };
}
