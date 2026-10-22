/**
 * Tests for apps/web/app/positions/[id]/remove/page.tsx auth-token sync.
 *
 * Strategy: mock position/wallet/panel modules; drive token changes through
 * localStorage + storage events (same mechanism as other-tab login/logout).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockUsePosition = vi.fn();

vi.mock('@/hooks/usePositions', () => ({
  usePosition: (...args: unknown[]) => mockUsePosition(...args),
}));

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: () => ({ address: 'GTEST123', walletKind: 'freighter' }),
}));

vi.mock('@/components/RemoveLiquidityPanel', () => ({
  RemoveLiquidityPanel: ({ authToken }: { authToken: string }) => (
    <div data-testid="remove-panel">{authToken}</div>
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@stellar/freighter-api', () => ({
  signMessage: vi.fn(),
}));

async function importPage() {
  const mod = await import('../app/positions/[id]/remove/page');
  return mod.default;
}

function dispatchStorageEvent(newValue: string | null) {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'swyft_auth_token',
      newValue,
      storageArea: window.localStorage,
    }),
  );
}

const mockPosition = {
  id: 'pos-1',
  token0: 'XLM',
  token1: 'USDC',
};

describe('RemoveLiquidityPage auth token sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUsePosition.mockReturnValue({
      position: mockPosition,
      loading: false,
      error: null,
    });
  });

  it('shows the authenticate CTA with no token, then the panel after login without a reload', async () => {
    const Page = await importPage();
    render(<Page params={Promise.resolve({ id: 'pos-1' })} />);

    expect(
      await screen.findByRole('button', { name: /authenticate wallet/i }),
    ).toBeDefined();

    window.localStorage.setItem('swyft_auth_token', 'tok-123');
    dispatchStorageEvent('tok-123');

    await waitFor(() => {
      expect(screen.getByTestId('remove-panel')).toBeDefined();
    });
    expect(
      screen.queryByRole('button', { name: /authenticate wallet/i }),
    ).toBeNull();
  });

  it('returns to the authenticate CTA when the token is cleared with the same address', async () => {
    window.localStorage.setItem('swyft_auth_token', 'tok-123');
    const Page = await importPage();
    render(<Page params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByTestId('remove-panel')).toBeDefined();
    });

    window.localStorage.removeItem('swyft_auth_token');
    dispatchStorageEvent(null);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /authenticate wallet/i }),
      ).toBeDefined();
    });
    expect(screen.queryByTestId('remove-panel')).toBeNull();
  });
});
