'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  NETWORK_STORAGE_KEY,
  SWYFT_NETWORK,
  isStellarNetwork,
  type StellarNetwork,
} from '@/lib/constants';

export interface NetworkContextValue {
  /** Currently selected network. Falls back to the build-time default until the persisted choice loads. */
  network: StellarNetwork;
  /** Switch the active network and persist the choice for future sessions. */
  setNetwork: (network: StellarNetwork) => void;
}

const defaultValue: NetworkContextValue = {
  network: SWYFT_NETWORK,
  setNetwork: () => {},
};

const NetworkContext = createContext<NetworkContextValue>(defaultValue);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<StellarNetwork>(SWYFT_NETWORK);

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
  }, []);

  const setNetwork = useCallback((next: StellarNetwork) => {
    setNetworkState(next);
    localStorage.setItem(NETWORK_STORAGE_KEY, next);
  }, []);

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>{children}</NetworkContext.Provider>
  );
}

export function useNetworkContext(): NetworkContextValue {
  return useContext(NetworkContext);
}
