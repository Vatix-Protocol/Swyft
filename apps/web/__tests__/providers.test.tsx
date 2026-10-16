import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { Providers, queryClientDefaults } from '../app/providers';

function ClientProbe() {
  const client = useQueryClient();
  const defaults = client.getDefaultOptions();

  return (
    <div>
      <span data-testid="refetch-on-window-focus">
        {String(defaults.queries?.refetchOnWindowFocus)}
      </span>
      <span data-testid="stale-time">{String(defaults.queries?.staleTime)}</span>
    </div>
  );
}

describe('Providers', () => {
  it('creates the QueryClient from the exported defaults', () => {
    render(
      <Providers>
        <ClientProbe />
      </Providers>,
    );

    expect(screen.getByTestId('refetch-on-window-focus')).toHaveTextContent(
      'false',
    );
    expect(screen.getByTestId('stale-time')).toHaveTextContent('30000');
  });

  it('does not retry 4xx client errors', () => {
    const retry = queryClientDefaults.queries.retry;

    expect(retry(0, { status: 400 })).toBe(false);
    expect(retry(0, { status: 404 })).toBe(false);
    expect(retry(0, { status: 499 })).toBe(false);
  });

  it('retries other errors a bounded number of times', () => {
    const retry = queryClientDefaults.queries.retry;

    expect(retry(0, { status: 500 })).toBe(true);
    expect(retry(1, { status: 500 })).toBe(true);
    expect(retry(2, { status: 500 })).toBe(false);
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
  });

  it('disables refetchOnWindowFocus in the defaults', () => {
    expect(queryClientDefaults.queries.refetchOnWindowFocus).toBe(false);
  });
});
