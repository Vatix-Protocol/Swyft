/**
 * Tests for apps/web/components/TransactionHistory.tsx
 *
 * Strategy:
 * - Mock useSwaps and useLpActivity so tests are pure unit tests
 * - Cover: pool filter narrows the LP activity list, filter is forwarded to
 *   the hook, and the empty-filter state renders distinctly from the
 *   generic empty state
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TransactionHistory } from '../components/TransactionHistory';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({
    network: 'TESTNET',
    apiBase: 'http://localhost:3001/v1',
    setNetwork: () => {},
  }),
}));

const mockUseSwaps = vi.fn();
vi.mock('@/hooks/useSwaps', () => ({
  useSwaps: (...args: unknown[]) => mockUseSwaps(...args),
}));

const mockUseLpActivity = vi.fn();
vi.mock('@/hooks/useLpActivity', () => ({
  useLpActivity: (...args: unknown[]) => mockUseLpActivity(...args),
}));

const activities = [
  {
    id: 'a1',
    type: 'mint',
    poolId: 'pool-1',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    amount0: '10',
    amount1: '1',
    txHash: 'hash1',
    walletAddress: 'GTEST',
    timestamp: 1_700_000_000,
  },
  {
    id: 'a2',
    type: 'burn',
    poolId: 'pool-2',
    token0Symbol: 'BTC',
    token1Symbol: 'USDC',
    amount0: '5',
    amount1: '2',
    txHash: 'hash2',
    walletAddress: 'GTEST',
    timestamp: 1_700_000_100,
  },
];

describe('TransactionHistory — LP pool filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSwaps.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false, error: null });
    mockUseLpActivity.mockReturnValue({
      data: { items: activities, total: activities.length },
      isLoading: false,
      error: null,
    });
  });

  it('populates the pool filter with distinct pools from unfiltered activity', async () => {
    render(<TransactionHistory walletAddress="GTEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'LP Activity' }));

    const select = await screen.findByLabelText('Pool:');
    expect(screen.getByRole('option', { name: 'XLM/USDC' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'BTC/USDC' })).toBeInTheDocument();
    expect(select).toHaveValue('');
  });

  it('forwards the selected pool to useLpActivity', async () => {
    render(<TransactionHistory walletAddress="GTEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'LP Activity' }));

    const select = await screen.findByLabelText('Pool:');
    fireEvent.change(select, { target: { value: 'pool-1' } });

    await waitFor(() => {
      expect(mockUseLpActivity).toHaveBeenLastCalledWith('GTEST', null, 1, 20, 'pool-1');
    });
  });

  it('shows a distinct empty state when a pool filter has no matches', async () => {
    mockUseLpActivity.mockImplementation((...args: unknown[]) => {
      const poolId = args[4];
      if (poolId === 'pool-1') {
        return { data: { items: [], total: 0 }, isLoading: false, error: null };
      }
      return { data: { items: activities, total: activities.length }, isLoading: false, error: null };
    });

    render(<TransactionHistory walletAddress="GTEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'LP Activity' }));

    // Options come from the initial unfiltered fetch; selecting one re-renders
    // with the (mocked) filtered empty result for that pool.
    const select = await screen.findByLabelText('Pool:');
    fireEvent.change(select, { target: { value: 'pool-1' } });

    await waitFor(() => {
      expect(screen.getByText('No LP activity for this pool')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
  });
});
