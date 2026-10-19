import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PoolDetailPage from './page';
import type { PoolDetail } from '@/hooks/usePoolDetail';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mockUsePoolDetail = vi.fn();

vi.mock('@/hooks/usePoolDetail', () => ({
  usePoolDetail: (id: string) => mockUsePoolDetail(id),
}));

describe('PoolDetailPage', () => {
  const mockPool: PoolDetail = {
    id: 'pool-123',
    token0: {
      address: 'token0-addr',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      decimals: 7,
    },
    token1: {
      address: 'token1-addr',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    feeTier: 30,
    currentSqrtPrice: '1000000',
    currentTick: -22000,
    totalLiquidity: '5000000',
    tvl: '1000000',
    volume24h: '500000',
    volume7d: '3500000',
    feeApr: '12.5',
    creationTimestamp: 1700000000,
    recentSwaps: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when isLoading is true', () => {
    mockUsePoolDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<PoolDetailPage params={Promise.resolve({ id: 'pool-123' })} />);

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders not-found panel when isError is true and calls router.push on back button click', () => {
    mockUsePoolDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<PoolDetailPage params={Promise.resolve({ id: 'pool-123' })} />);

    expect(screen.getByText('Pool not found')).toBeInTheDocument();
    expect(screen.getByText(/The pool you're looking for doesn't exist/)).toBeInTheDocument();

    const backButton = screen.getByRole('button', { name: /back to pools/i });
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);
    expect(mockPush).toHaveBeenCalledWith('/pools');
  });

  it('renders not-found panel when pool data is null', () => {
    mockUsePoolDetail.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });

    render(<PoolDetailPage params={Promise.resolve({ id: 'pool-123' })} />);

    expect(screen.getByText('Pool not found')).toBeInTheDocument();

    const backButton = screen.getByRole('button', { name: /back to pools/i });
    fireEvent.click(backButton);
    expect(mockPush).toHaveBeenCalledWith('/pools');
  });

  it('renders pool details when pool is loaded and handles action button clicks', () => {
    mockUsePoolDetail.mockReturnValue({
      data: mockPool,
      isLoading: false,
      isError: false,
    });

    render(<PoolDetailPage params={Promise.resolve({ id: 'pool-123' })} />);

    // Assert pool name derived from token0.symbol/token1.symbol is rendered
    expect(screen.getByText('XLM/USDC')).toBeInTheDocument();
    expect(screen.getByText('Stellar Lumens')).toBeInTheDocument();
    expect(screen.getByText('USD Coin')).toBeInTheDocument();
    expect(screen.getByText('$1.00M')).toBeInTheDocument(); // TVL

    // Test Swap button
    const swapButton = screen.getByRole('button', { name: /^swap$/i });
    fireEvent.click(swapButton);
    expect(mockPush).toHaveBeenCalledWith(
      '/swap?tokenIn=token0-addr&tokenOut=token1-addr'
    );

    // Test Add liquidity button
    const addLiquidityButton = screen.getByRole('button', { name: /add liquidity/i });
    fireEvent.click(addLiquidityButton);
    expect(mockPush).toHaveBeenCalledWith('/liquidity/add?poolId=pool-123');
  });
});
