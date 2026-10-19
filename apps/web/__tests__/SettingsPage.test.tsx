/**
 * Tests for apps/web/app/settings/page.tsx
 *
 * Strategy:
 * - Mock all external hooks and modules so tests are pure unit tests
 * - Cover: redirect when no wallet, token picked up via storage event, token cleared
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Module mocks ────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockUseWalletContext = vi.fn();

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: () => mockUseWalletContext(),
}));

// WebhooksPanel is a child component — render a lightweight stub so tests stay
// focused on SettingsPage behaviour rather than panel internals.
const mockUseWebhooks = vi.fn();

vi.mock('@/hooks/useWebhooks', () => ({
  useWebhooks: (...args: unknown[]) => mockUseWebhooks(...args),
}));

// Freighter API — not exercised in these unit tests
vi.mock('@stellar/freighter-api', () => ({
  signMessage: vi.fn(),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Lazy import so mocks are registered before the module is evaluated
async function importPage() {
  const mod = await import('../app/settings/page');
  return mod.default;
}

// Simulate a storage event on the window
function dispatchStorageEvent(key: string, newValue: string | null) {
  const event = new StorageEvent('storage', {
    key,
    newValue,
    storageArea: window.localStorage,
  });
  window.dispatchEvent(event);
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplace.mockReset();
    mockUseWebhooks.mockReset();
    // Default: wallet connected
    mockUseWalletContext.mockReturnValue({ address: 'GTEST123' });
    mockUseWebhooks.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      createWebhook: vi.fn(),
      removeWebhook: vi.fn(),
    });
    // Silence localStorage in jsdom
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Redirect ──────────────────────────────────────────────────────────────────

  it('redirects to / when wallet is not connected', async () => {
    mockUseWalletContext.mockReturnValue({ address: null });

    const SettingsPage = await importPage();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('does not redirect when wallet is connected', async () => {
    const SettingsPage = await importPage();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // ── Auth token handling ───────────────────────────────────────────────────────

  it('picks up auth token written to localStorage after initial render via storage event', async () => {
    // Start with no token
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    const SettingsPage = await importPage();
    render(<SettingsPage />);

    // Initially WebhooksPanel should receive null token
    await waitFor(() => {
      expect(mockUseWebhooks).toHaveBeenCalledWith(null);
    });

    // Now simulate another tab writing the token
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'new-token-from-storage'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    dispatchStorageEvent('swyft_auth_token', 'new-token-from-storage');

    // WebhooksPanel should now receive the new token
    await waitFor(() => {
      expect(mockUseWebhooks).toHaveBeenCalledWith('new-token-from-storage');
    });
  });

  it('passes null to WebhooksPanel when token is cleared via storage event', async () => {
    // Start with a token present
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'existing-token'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    const SettingsPage = await importPage();
    render(<SettingsPage />);

    // Initially WebhooksPanel should receive the existing token
    await waitFor(() => {
      expect(mockUseWebhooks).toHaveBeenCalledWith('existing-token');
    });

    // Now simulate the token being cleared (logout)
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    dispatchStorageEvent('swyft_auth_token', null);

    // WebhooksPanel should now receive null
    await waitFor(() => {
      expect(mockUseWebhooks).toHaveBeenCalledWith(null);
    });
  });

  it('reads initial token from localStorage on mount', async () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'initial-token'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    const SettingsPage = await importPage();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockUseWebhooks).toHaveBeenCalledWith('initial-token');
    });
  });
});