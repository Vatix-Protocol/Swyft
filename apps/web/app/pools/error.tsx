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
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-zinc-500 mb-4">
          We couldn&apos;t load the pools list. This might be a temporary issue.
        </p>
        <button
          onClick={unstable_retry}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
