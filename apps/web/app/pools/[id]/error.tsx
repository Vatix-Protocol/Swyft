'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function PoolDetailError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('Pool detail page error:', error);
  }, [error]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <Link
          href="/pools"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Pools
        </Link>
      </div>
      <div role="alert" className="text-center py-12">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-zinc-500 mb-4">
          We couldn&apos;t load this pool. This might be a temporary issue.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={unstable_retry}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/pools"
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Back to pools
          </Link>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-zinc-400">Reference: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
