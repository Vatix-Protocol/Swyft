import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PoolsPage from './page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockUsePools = vi.fn();

vi.mock('@/hooks/usePools', () => ({
  usePools: () => mockUsePools(),
}));

vi.mock('@/hooks/useSearchDebounce', () => ({
  useSearchDebounce: (val: string) => val,
}));

describe('PoolsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pool with real token symbols correctly', () => {
    mockUsePools.mockReturnValue({
      data: {
        items: [
          {
            id: 'pool-1',
            token0: 'XLM',
            token1: 'USDC',
            feeTier: '30',
            tvl: 1000000,
            volume24h: 500000,
            volume7d: 3500000,
            feeApr: 12.5,
            currentPrice: 0.1,
          },
        ],
        totalPages: 1,
      },
      isLoading: false,
      isError: false,
      misconfigError: null,
    });

    render(<PoolsPage />);

    expect(screen.getByText('XLM/USDC')).toBeInTheDocument();
  });

  it('renders pool without token metadata with the documented fallback and accessible name', () => {
    const addr0 = 'C1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const addr1 = 'C9876543210fedcba9876543210fedcba9876543210fedcba98765432';

    mockUsePools.mockReturnValue({
      data: {
        items: [
          {
            id: 'pool-2',
            token0: addr0,
            token1: addr1,
            feeTier: '30',
            tvl: 500000,
            volume24h: 100000,
            volume7d: 700000,
            feeApr: 5.0,
            currentPrice: 1.0,
          },
        ],
        totalPages: 1,
      },
      isLoading: false,
      isError: false,
      misconfigError: null,
    });

    render(<PoolsPage />);

    // Renders fallback symbol starting with '?'
    expect(screen.getByText(/\?C123…\/\?C987…/)).toBeInTheDocument();
  });
});