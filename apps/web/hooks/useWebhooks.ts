'use client';

import { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '@/lib/constants';

export interface WebhookItem {
  id: string;
  url: string;
  eventTypes: string[];
  disabled: boolean;
  createdAt: string;
}

export function useWebhooks(authToken: string | null) {
  const [items, setItems] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWebhooks = useCallback(() => {
    if (!authToken) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/webhooks`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load webhooks');
        return r.json() as Promise<{ loading: boolean; items: WebhookItem[] }>;
      })
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    const cancel = fetchWebhooks();
    return cancel;
  }, [fetchWebhooks]);

  const createWebhook = useCallback(
    async (body: { url: string; eventTypes: string[]; secret?: string; largeSwapUsd?: number }) => {
      if (!authToken) return;
      setLoading(true);
      try {
        const r = await fetch(`${API_BASE}/webhooks`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error('Failed to create webhook');
        fetchWebhooks();
      } finally {
        setLoading(false);
      }
    },
    [authToken, fetchWebhooks]
  );

  const removeWebhook = useCallback(
    async (id: string) => {
      if (!authToken) return;
      setLoading(true);
      try {
        await fetch(`${API_BASE}/webhooks/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        fetchWebhooks();
      } finally {
        setLoading(false);
      }
    },
    [authToken, fetchWebhooks]
  );

  return { items, loading, error, createWebhook, removeWebhook };
}
