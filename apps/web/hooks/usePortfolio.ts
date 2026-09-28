'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PositionSnapshot } from '@swyft/ui';
import { useNetworkContext } from '@/context/NetworkContext';

interface ApiPosition {
  id: string;
  ownerWallet: string;
  poolId: string;
  tokenId: string | null;
  tokenPair: { token0: string; token1: string };
  lowerTick: number;
  upperTick: number;
  liquidity: string;
  currentValueUsd: number;
  poolCurrentPrice: number;
  uncollectedFeesToken0: string;
  uncollectedFeesToken1: string;
  createdAt: number;
  closedAt: number | null;
  status: 'active' | 'closed';
}

function isApiPosition(value: unknown): value is ApiPosition {
  if (value === null || typeof value !== 'object') return false;
  const position = value as Record<string, unknown>;
  const tokenPair = position.tokenPair;
  return (
    typeof position.id === 'string' &&
    typeof position.ownerWallet === 'string' &&
    typeof position.poolId === 'string' &&
    (position.tokenId === null || typeof position.tokenId === 'string') &&
    tokenPair !== null &&
    typeof tokenPair === 'object' &&
    typeof (tokenPair as Record<string, unknown>).token0 === 'string' &&
    typeof (tokenPair as Record<string, unknown>).token1 === 'string' &&
    Number.isInteger(position.lowerTick) &&
    Number.isInteger(position.upperTick) &&
    typeof position.liquidity === 'string' &&
    typeof position.currentValueUsd === 'number' &&
    Number.isFinite(position.currentValueUsd) &&
    typeof position.poolCurrentPrice === 'number' &&
    Number.isFinite(position.poolCurrentPrice) &&
    typeof position.uncollectedFeesToken0 === 'string' &&
    typeof position.uncollectedFeesToken1 === 'string' &&
    typeof position.createdAt === 'number' &&
    Number.isFinite(position.createdAt) &&
    (position.closedAt === null ||
      (typeof position.closedAt === 'number' && Number.isFinite(position.closedAt))) &&
    (position.status === 'active' || position.status === 'closed')
  );
}

function toPositionSnapshot(position: ApiPosition): PositionSnapshot {
  return {
    ...position,
    token0: position.tokenPair.token0,
    token1: position.tokenPair.token1,
  };
}

async function fetchPositions(
  authToken: string,
  status: 'all',
  apiBase: string,
  page: number,
): Promise<{ items: ApiPosition[]; total: number }> {
  const params = new URLSearchParams({ status, page: String(page), limit: '50' });
  const res = await fetch(`${apiBase}/positions?${params}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load positions (HTTP ${res.status})`);
  const data: unknown = await res.json();
  if (data === null || typeof data !== 'object') {
    throw new Error('Invalid positions response');
  }
  const response = data as { items?: unknown; total?: unknown };
  if (
    !Array.isArray(response.items) ||
    !response.items.every(isApiPosition) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0
  ) {
    throw new Error('Invalid positions response');
  }
  return { items: response.items, total: response.total as number };
}

export function usePortfolio(authToken: string | null) {
  const { apiBase } = useNetworkContext();
  const [active, setActive] = useState<PositionSnapshot[]>([]);
  const [closed, setClosed] = useState<PositionSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!authToken) {
      setActive([]);
      setClosed([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const positions: ApiPosition[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await fetchPositions(authToken, 'all', apiBase, page);
        positions.push(...response.items);
        total = response.total;
        if (positions.length > total || response.items.length > 50) {
          throw new Error('Positions response contains inconsistent pagination data');
        }
        if (new Set(positions.map((position) => position.id)).size !== positions.length) {
          throw new Error('Positions response contains duplicate records');
        }
        if (response.items.length === 0 && positions.length < total) {
          throw new Error('Positions response ended before all results were loaded');
        }
        page += 1;
      } while (positions.length < total);

      if (currentRequest === requestId.current) {
        const snapshots = positions.map(toPositionSnapshot);
        setActive(snapshots.filter((position) => position.status === 'active'));
        setClosed(snapshots.filter((position) => position.status === 'closed'));
      }
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : 'Failed to load positions');
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [authToken, apiBase]);

  useEffect(() => {
    refresh();
    if (!authToken) return;
    const id = setInterval(refresh, 30_000);
    return () => {
      clearInterval(id);
      requestId.current += 1;
    };
  }, [authToken, refresh]);

  const totalValueUsd = active.reduce((sum, p) => sum + p.currentValueUsd, 0);

  return { active, closed, loading, error, refresh, totalValueUsd };
}
