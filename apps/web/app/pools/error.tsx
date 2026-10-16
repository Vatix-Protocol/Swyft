'use client';

import { useEffect } from 'react';

export default function PoolsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('Pools page error:', error);
  }, [error]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div role="alert" className="text-center py-12">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-zinc-500 mb-4">
          We couldn&apos;t load the pools. This might be a temporary issue.
        </p>
        <button
          onClick={unstable_retry}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 text-xs text-zinc-400">Reference: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
