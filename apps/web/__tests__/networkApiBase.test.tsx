import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NetworkProvider, useNetworkContext } from '@/context/NetworkContext';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';

/**
 * Integration test: the network switcher must route API traffic to the
 * per-network URL configured for the selected network (this is the
 * production path — testnet and mainnet point at different API deployments).
 * Without the overrides, both networks silently share NEXT_PUBLIC_API_URL and
 * a user who switches to PUBLIC keeps getting testnet/localhost data.
 */

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: vi.fn().mockReturnValue({
    address: null,
    disconnect: vi.fn(),
  }),
}));

function ApiBaseDisplay() {
  const { network, apiBase } = useNetworkContext();
  return (
    <div>
      <span data-testid="network">{network}</span>
      <span data-testid="apiBase">{apiBase}</span>
    </div>
  );
}

describe('NetworkSwitcher — per-network API base URL', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function renderWithProviders() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <NetworkSwitcher />
          <ApiBaseDisplay />
        </NetworkProvider>
      </QueryClientProvider>,
    );
  }

  it('routes each network to its own configured API URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL_TESTNET', 'https://api-testnet.swyft.dev');
    vi.stubEnv('NEXT_PUBLIC_API_URL_PUBLIC', 'https://api-mainnet.swyft.dev');

    renderWithProviders();

    // Build-time default network is TESTNET.
    expect(screen.getByTestId('network').textContent).toBe('TESTNET');
    expect(screen.getByTestId('apiBase').textContent).toBe('https://api-testnet.swyft.dev/v1');

    // Switch to PUBLIC — the API base must move to the mainnet URL.
    fireEvent.click(screen.getByRole('button', { name: /testnet/i }));
    fireEvent.click(screen.getByRole('option', { selected: false }).querySelector('button')!);

    expect(screen.getByTestId('network').textContent).toBe('PUBLIC');
    expect(screen.getByTestId('apiBase').textContent).toBe('https://api-mainnet.swyft.dev/v1');
  });

  it('falls back to the shared NEXT_PUBLIC_API_URL when no per-network override is set', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.swyft.dev');

    renderWithProviders();
    expect(screen.getByTestId('apiBase').textContent).toBe('https://api.swyft.dev/v1');

    fireEvent.click(screen.getByRole('button', { name: /testnet/i }));
    fireEvent.click(screen.getByRole('option', { selected: false }).querySelector('button')!);

    expect(screen.getByTestId('network').textContent).toBe('PUBLIC');
    expect(screen.getByTestId('apiBase').textContent).toBe('https://api.swyft.dev/v1');
  });
});
