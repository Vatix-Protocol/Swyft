'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NETWORK_STORAGE_KEY,
  SWYFT_NETWORK,
  isStellarNetwork,
  getApiBase,
  type StellarNetwork,
} from '@/lib/constants';

export interface NetworkContextValue {
  /** Currently selected network. Falls back to the build-time default until the persisted choice loads. */
  network: StellarNetwork;
  /** Whether the persisted network selection has been restored. */
  ready: boolean;
  /** API base URL for the currently selected network. */
  apiBase: string;
  /** Switch the active network and persist the choice for future sessions. */
  setNetwork: (network: StellarNetwork) => void;
}

const defaultValue: NetworkContextValue = {
  network: SWYFT_NETWORK,
  ready: false,
  apiBase: getApiBase(SWYFT_NETWORK),
  setNetwork: () => {},
};

const NetworkContext = createContext<NetworkContextValue>(defaultValue);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<StellarNetwork>(SWYFT_NETWORK);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  // Network a setNetwork call is switching to, awaiting commit. Invalidation is
  // deferred until the provider has re-rendered with that network so every
  // refetch it triggers reads the new apiBase rather than the previous one.
  const pendingSwitch = useRef<StellarNetwork | null>(null);

  // Restore a persisted selection on mount. An unset or corrupted value
  // (e.g. edited manually, or written by a future/older app version) is
  // treated as absent and silently falls back to the env default.
  useEffect(() => {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (isStellarNetwork(stored)) {
      setNetworkState(stored);
    } else if (stored !== null) {
      localStorage.removeItem(NETWORK_STORAGE_KEY);
    }
    setReady(true);
  }, []);

  // Runs after the commit that applied the switch. Consumers' effects run
  // before this parent effect, so their queries already hold the new apiBase.
  useEffect(() => {
    if (!ready || pendingSwitch.current !== network) return;
    pendingSwitch.current = null;
    // Invalidate all cached queries so hooks refetch against the new API.
    queryClient.invalidateQueries();
  }, [network, ready, queryClient]);

  const setNetwork = useCallback((next: StellarNetwork) => {
    pendingSwitch.current = next;
    setNetworkState(next);
    setReady(true);
    localStorage.setItem(NETWORK_STORAGE_KEY, next);
  }, []);

  const apiBase = getApiBase(network);

  return (
    <NetworkContext.Provider value={{ network, ready, apiBase, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkContext(): NetworkContextValue {
  return useContext(NetworkContext);
}
