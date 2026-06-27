'use client';

import { useState } from 'react';
import { useWebhooks } from '@/hooks/useWebhooks';

const WEBHOOK_EVENT_OPTIONS = [
  { value: 'pool.created', label: 'Pool Created' },
  { value: 'swap.large', label: 'Large Swap' },
  { value: 'pool.tvl.milestone', label: 'TVL Milestone' },
] as const;

interface WebhooksPanelProps {
  authToken: string | null;
}

function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="px-4 py-3">
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-5 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-7 w-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      </td>
    </tr>
  );
}

export function WebhooksPanel({ authToken }: WebhooksPanelProps) {
  const { items, loading, error, createWebhook, removeWebhook } = useWebhooks(authToken);

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState('');

  function toggleEvent(value: string) {
    setSelectedEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || selectedEvents.length === 0) return;
    await createWebhook({ url, eventTypes: selectedEvents, secret: secret || undefined });
    setUrl('');
    setSelectedEvents([]);
    setSecret('');
    setShowForm(false);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Webhooks</h2>
          {loading && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
              aria-label="Loading webhooks"
            />
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          disabled={loading}
          aria-label="Register a new webhook"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showForm ? 'Cancel' : 'Register'}
        </button>
      </div>

      {/* Registration form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800"
          aria-label="Register webhook form"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="webhook-url"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Endpoint URL
              </label>
              <input
                id="webhook-url"
                type="url"
                required
                placeholder="https://example.com/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Event types
              </p>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENT_OPTIONS.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selectedEvents.includes(value)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedEvents.includes(value)}
                      onChange={() => toggleEvent(value)}
                      disabled={loading}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="webhook-secret"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Signing secret <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                id="webhook-secret"
                type="text"
                placeholder="HMAC-SHA256 secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !url || selectedEvents.length === 0}
              className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save webhook'}
            </button>
          </div>
        </form>
      )}

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Webhook list */}
      <div className="overflow-x-auto" aria-busy={loading} aria-live="polite">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">URL</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Events</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {/* Skeleton rows while loading with no existing items yet */}
            {loading &&
              items.length === 0 &&
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}

            {/* Empty state */}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-zinc-400 dark:text-zinc-600">
                  No webhooks registered yet. Click{' '}
                  <strong className="font-medium text-zinc-600 dark:text-zinc-400">Register</strong>{' '}
                  to add your first endpoint.
                </td>
              </tr>
            )}

            {/* Data rows */}
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
              >
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {item.url}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {item.eventTypes.map((evt) => (
                      <span
                        key={evt}
                        className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        {evt}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {item.disabled ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950 dark:text-red-400">
                      Disabled
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => removeWebhook(item.id)}
                    disabled={loading}
                    aria-label={`Delete webhook ${item.url}`}
                    className="rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
