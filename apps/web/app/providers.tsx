'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Default options for the app-wide QueryClient.
 *
 * - `retry`: bounded retry policy that never retries 4xx client errors.
 * - `staleTime`: pool/quote data is considered fresh for 30s to avoid
 *   redundant refetches across mounted hooks.
 * - `refetchOnWindowFocus`: disabled so window focus does not refetch every
 *   mounted query.
 */
export const queryClientDefaults = {
  queries: {
    retry: (failureCount: number, error: unknown) => {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status?: number }).status
          : undefined;

      if (typeof status === 'number' && status >= 400 && status < 500) {
        return false;
      }

      return failureCount < 2;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: queryClientDefaults }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
