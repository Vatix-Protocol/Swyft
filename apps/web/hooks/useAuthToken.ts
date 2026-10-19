'use client';

import { useEffect, useState } from 'react';
import { AUTH_TOKEN_STORAGE_KEY, getAuthToken as getAuthTokenLib } from '@/lib/auth';

/**
 * Hook that reads the auth token from localStorage and reacts to changes.
 *
 * - Reads the token on mount via `getAuthToken()`.
 * - Subscribes to the `storage` event so tokens written in other tabs (or
 *   after the initial render) are picked up automatically.
 * - Returns `null` when the token is cleared.
 */
export function useAuthToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Initial read
    setToken(getAuthTokenLib());

    // React to cross-tab storage changes
    function handleStorageEvent(event: StorageEvent) {
      if (event.key === AUTH_TOKEN_STORAGE_KEY) {
        setToken(event.newValue);
      }
    }

    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, []);

  return token;
}