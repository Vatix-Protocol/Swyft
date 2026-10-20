/**
 * Tests for apps/web/app/history/page.tsx
 *
 * Strategy:
 * - Mock useWalletContext and TransactionHistory so tests are pure unit tests
 * - Cover: disconnected state shows connect prompt, no redirect occurs,
 *   and TransactionHistory renders when wallet is connected
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('@/components/TransactionHistory', () => ({
  TransactionHistory: ({ walletAddress }: { walletAddress: string }) => (
    <div data-testid="transaction-history">TransactionHistory for {walletAddress}</div>
  ),
}));

vi.mock('@/components/WalletButton', () => ({
  WalletButton: () => <button data-testid="wallet-button">Connect wallet</button>,
}));

const mockUseWalletContext = vi.fn();

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: () => mockUseWalletContext(),
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({
    network: 'TESTNET',
    apiBase: 'http://localhost:3001/v1',
    setNetwork: () => {},
  }),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function importPage() {
  const mod = await import('../app/history/page');
  return mod.default;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockUseWalletContext.mockReturnValue({ address: null });
  });

  // ── Disconnected state ──────────────────────────────────────────────────────

  it('shows the heading and a connect prompt when no wallet is connected', async () => {
    const HistoryPage = await importPage();
    render(<HistoryPage />);

    expect(screen.getByText('Transaction History')).toBeInTheDocument();
    expect(screen.getByText('Connect your wallet to view transaction history.')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-button')).toBeInTheDocument();
  });

  it('does not redirect when no wallet is connected', async () => {
    const HistoryPage = await importPage();
    render(<HistoryPage />);

    // Wait for any effects to run
    await waitFor(() => {
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // ── Connected state ─────────────────────────────────────────────────────────

  it('renders TransactionHistory when wallet is connected', async () => {
    mockUseWalletContext.mockReturnValue({ address: 'GTEST123' });

    const HistoryPage = await importPage();
    render(<HistoryPage />);

    expect(screen.getByTestId('transaction-history')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-history')).toHaveTextContent(
      'TransactionHistory for GTEST123'
    );
  });

  it('does not show the connect prompt when wallet is connected', async () => {
    mockUseWalletContext.mockReturnValue({ address: 'GTEST123' });

    const HistoryPage = await importPage();
    render(<HistoryPage />);

    expect(screen.queryByText('Connect your wallet to view transaction history.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wallet-button')).not.toBeInTheDocument();
  });
});