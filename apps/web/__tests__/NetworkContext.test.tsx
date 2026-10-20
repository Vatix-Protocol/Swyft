import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { NetworkProvider, useNetworkContext } from '@/context/NetworkContext';
import { NETWORK_STORAGE_KEY, type StellarNetwork } from '@/lib/constants';

/**
 * Ordering contract for setNetwork: the refetch triggered by a network switch
 * must run against the newly selected network's apiBase, never the previous
 * one, and the persisted choice must match the network whose apiBase is exposed.
 */

vi.mock('@/lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/constants')>();
  return {
    ...actual,
    getApiBase: (network: StellarNetwork) => `https://${network.toLowerCase()}.api.test/v1`,
  };
});

const TESTNET_BASE = 'https://testnet.api.test/v1';
const PUBLIC_BASE = 'https://public.api.test/v1';

/** apiBase each probe fetch was issued against, in call order. */
let requestedBases: string[];

/**
 * Consumer hook in the shape of the app's data hooks: reads apiBase from
 * context and closes over it in queryFn. The key deliberately omits apiBase so
 * only the switch's invalidation can trigger the refetch.
 */
function ApiBaseProbe() {
  const { network, apiBase, setNetwork } = useNetworkContext();
  const { data } = useQuery({
    queryKey: ['probe'],
    queryFn: async () => {
      requestedBases.push(apiBase);
      return apiBase;
    },
  });
  return (
    <div>
      <span data-testid="network">{network}</span>
      <span data-testid="apiBase">{apiBase}</span>
      <span data-testid="data">{data ?? ''}</span>
      <button type="button" onClick={() => setNetwork('PUBLIC')}>
        switch
      </button>
    </div>
  );
}

describe('NetworkContext setNetwork ordering', () => {
  let queryClient: QueryClient;
  let storage: Map<string, string>;
  let storageStub: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    requestedBases = [];
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    storage = new Map();
    storageStub = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    };
    vi.stubGlobal('localStorage', storageStub);
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  function renderProvider() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <ApiBaseProbe />
        </NetworkProvider>
      </QueryClientProvider>,
    );
  }

  it('refetches against the new network apiBase after setNetwork', async () => {
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent(TESTNET_BASE));
    expect(requestedBases).toEqual([TESTNET_BASE]);

    fireEvent.click(screen.getByRole('button', { name: 'switch' }));

    expect(screen.getByTestId('network')).toHaveTextContent('PUBLIC');
    expect(screen.getByTestId('apiBase')).toHaveTextContent(PUBLIC_BASE);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent(PUBLIC_BASE));
    // Every fetch after the switch hit the mainnet base — none leaked to testnet.
    expect(requestedBases).toEqual([TESTNET_BASE, PUBLIC_BASE]);
  });

  it('persists the same network whose apiBase is exposed', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent(TESTNET_BASE));

    fireEvent.click(screen.getByRole('button', { name: 'switch' }));

    expect(storageStub.setItem).toHaveBeenCalledWith(NETWORK_STORAGE_KEY, 'PUBLIC');
    const persisted = storage.get(NETWORK_STORAGE_KEY);
    expect(persisted).toBe(screen.getByTestId('network').textContent);
    expect(screen.getByTestId('apiBase')).toHaveTextContent(
      `https://${persisted!.toLowerCase()}.api.test/v1`,
    );
  });

  it('does not invalidate on mount when restoring a persisted network', async () => {
    storage.set(NETWORK_STORAGE_KEY, 'PUBLIC');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('network')).toHaveTextContent('PUBLIC'));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('removes a corrupted persisted value and falls back to the env default', async () => {
    storage.set(NETWORK_STORAGE_KEY, 'not-a-network');

    renderProvider();

    await waitFor(() =>
      expect(storageStub.removeItem).toHaveBeenCalledWith(NETWORK_STORAGE_KEY),
    );
    expect(storage.has(NETWORK_STORAGE_KEY)).toBe(false);
    expect(screen.getByTestId('network')).toHaveTextContent('TESTNET');
    expect(screen.getByTestId('apiBase')).toHaveTextContent(TESTNET_BASE);
  });
});
