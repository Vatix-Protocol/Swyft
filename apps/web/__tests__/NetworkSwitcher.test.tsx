import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NetworkProvider, useNetworkContext } from '@/context/NetworkContext';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { getApiBase } from '@/lib/constants';

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

describe('NetworkSwitcher updates API base URL', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('exposes apiBase matching the default network', () => {
    renderWithProviders();
    const apiBase = screen.getByTestId('apiBase').textContent;
    expect(apiBase).toBe(getApiBase('TESTNET'));
  });

  it('updates apiBase when network is switched', () => {
    renderWithProviders();

    // Open the dropdown
    fireEvent.click(screen.getByRole('button', { name: /testnet/i }));

    // Select Mainnet
    const mainnetOption = screen.getByRole('option', { selected: false });
    fireEvent.click(mainnetOption.querySelector('button')!);

    expect(screen.getByTestId('network').textContent).toBe('PUBLIC');
    expect(screen.getByTestId('apiBase').textContent).toBe(getApiBase('PUBLIC'));
  });

  it('invalidates queries when network changes', () => {
    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: /testnet/i }));
    const mainnetOption = screen.getByRole('option', { selected: false });
    fireEvent.click(mainnetOption.querySelector('button')!);

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('does not invalidate queries when same network is selected', () => {
    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: /testnet/i }));
    // Click the already-selected Testnet option
    const testnetOption = screen.getByRole('option', { selected: true });
    fireEvent.click(testnetOption.querySelector('button')!);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
