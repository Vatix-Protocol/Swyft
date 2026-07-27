import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionHistory } from './TransactionHistory';
import type { SwapSnapshot } from '@/hooks/useSwaps';

const PAGE_SIZE = 20;

// ─── Mock hooks ────────────────────────────────────────────────────────────────

const mockUseSwaps = vi.fn();
const mockUseLpActivity = vi.fn();

vi.mock('@/hooks/useSwaps', () => ({
  useSwaps: (...args: unknown[]) => mockUseSwaps(...args),
}));

vi.mock('@/hooks/useLpActivity', () => ({
  useLpActivity: (...args: unknown[]) => mockUseLpActivity(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSwap(id: string): SwapSnapshot {
  return {
    id,
    poolId: 'pool-1',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    amount0: '100',
    amount1: '10',
    priceAtSwap: '0.1',
    txHash: `hash-${id}`,
    walletAddress: 'GABC',
    timestamp: 1700000000,
  };
}

/** Total swap count used across tests: two full pages of 20. */
const TOTAL_SWAPS = 40;

function defaultSwapsImpl(_wallet: string | null, page: number) {
  const count = Math.max(0, Math.min(PAGE_SIZE, TOTAL_SWAPS - (page - 1) * PAGE_SIZE));
  return {
    data: { items: Array.from({ length: count }, (_, i) => makeSwap(`${page}-${i}`)), total: TOTAL_SWAPS },
    isLoading: false,
    error: null,
  };
}

beforeEach(() => {
  mockUseSwaps.mockReset();
  mockUseLpActivity.mockReset();
  mockUseSwaps.mockImplementation(defaultSwapsImpl);
  mockUseLpActivity.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    error: null,
  });
});

describe('TransactionHistory pagination', () => {
  it('hides pagination controls when there is only one page', () => {
    mockUseSwaps.mockReturnValue({
      data: { items: [makeSwap('1')], total: 1 },
      isLoading: false,
      error: null,
    });

    render(<TransactionHistory walletAddress="GABC" />);

    expect(screen.queryByText(/^Page \d+ of \d+$/)).not.toBeInTheDocument();
  });

  it('shows Prev/Next controls and disables Previous on the first page', () => {
    render(<TransactionHistory walletAddress="GABC" />);

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('advances to the next page and requests it from the API', () => {
    render(<TransactionHistory walletAddress="GABC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(mockUseSwaps).toHaveBeenLastCalledWith('GABC', 2, PAGE_SIZE);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });

  it('shows a distinct empty-page notice (not the zero-history message) when the current page has no items', () => {
    mockUseSwaps.mockImplementation((_wallet: string | null, page: number) => ({
      data: { items: page === 1 ? [makeSwap('1')] : [], total: TOTAL_SWAPS },
      isLoading: false,
      error: null,
    }));

    render(<TransactionHistory walletAddress="GABC" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('No results on this page')).toBeInTheDocument();
    expect(screen.queryByText('No swap history yet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to page 1' }));
    expect(mockUseSwaps).toHaveBeenLastCalledWith('GABC', 1, PAGE_SIZE);
  });

  it('shows the zero-history message (not the empty-page notice) when there is no history at all', () => {
    mockUseSwaps.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
    });

    render(<TransactionHistory walletAddress="GABC" />);

    expect(screen.getByText('No swap history yet')).toBeInTheDocument();
    expect(screen.queryByText('No results on this page')).not.toBeInTheDocument();
  });
});
