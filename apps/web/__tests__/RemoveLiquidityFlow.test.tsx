/**
 * Integration test for remove liquidity flow
 * Tests the complete user flow from position loading to liquidity removal
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

const mockEstimateRemoveAmountsAsync = vi.fn();
const mockUseRemoveLiquidity = vi.fn();

vi.mock('@swyft/sdk', () => ({
  estimateRemoveAmountsAsync: (...args: unknown[]) => mockEstimateRemoveAmountsAsync(...args),
}));

vi.mock('@/hooks/useRemoveLiquidity', () => ({
  useRemoveLiquidity: (...args: unknown[]) => mockUseRemoveLiquidity(...args),
}));

vi.mock('@/hooks/usePositions', () => ({
  usePosition: () => ({
    position: mockPosition,
    loading: false,
    error: null,
  }),
}));

// ─── Test data ─────────────────────────────────────────────────────────────────

const mockPosition: PositionSnapshot = {
  id: 'pos-1',
  ownerWallet: 'GTEST123',
  poolId: 'pool-xlm-usdc',
  token0: 'XLM',
  token1: 'USDC',
  lowerTick: -1000,
  upperTick: 1000,
  liquidity: '1000000',
  currentValueUsd: 500,
  uncollectedFeesToken0: '1.5',
  uncollectedFeesToken1: '0.5',
  createdAt: 1_700_000_000,
  closedAt: null,
  status: 'active',
  poolCurrentPrice: 0.1085,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function importPage() {
  const mod = await import('../app/positions/[id]/remove/page');
  return mod.default;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RemoveLiquidityFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateRemoveAmountsAsync.mockResolvedValue({
      amount0: '10.5',
      amount1: '5.2',
    });
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'idle',
      txError: null,
      txHash: null,
      removeLiquidity: vi.fn(),
      collectFees: vi.fn(),
      reset: vi.fn(),
    });
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: vi.fn(() => 'mock-token'), setItem: vi.fn(), removeItem: vi.fn() },
      writable: true,
    });
  });

  it('loads the remove liquidity page with position data', async () => {
    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('Remove liquidity')).toBeInTheDocument();
    });
  });

  it('displays position details including price range and current price', async () => {
    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('Price range')).toBeInTheDocument();
      expect(screen.getByText('Current price')).toBeInTheDocument();
      expect(screen.getByText('Position value')).toBeInTheDocument();
    });
  });

  it('shows uncollected fees with collect button', async () => {
    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('Uncollected fees')).toBeInTheDocument();
      expect(screen.getByText('Collect fees only')).toBeInTheDocument();
    });
  });

  it('allows selecting preset percentages (25, 50, 75, 100)', async () => {
    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('25%')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  it('calls removeLiquidity when remove button is clicked', async () => {
    const mockRemoveLiquidity = vi.fn();
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'idle',
      txError: null,
      txHash: null,
      removeLiquidity: mockRemoveLiquidity,
      collectFees: vi.fn(),
      reset: vi.fn(),
    });

    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('Remove 100% liquidity')).toBeInTheDocument();
    });

    const removeButton = screen.getByText('Remove 100% liquidity');
    fireEvent.click(removeButton);

    expect(mockRemoveLiquidity).toHaveBeenCalledWith(100);
  });

  it('shows success state after successful removal', async () => {
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'success',
      txError: null,
      txHash: 'abc123',
      removeLiquidity: vi.fn(),
      collectFees: vi.fn(),
      reset: vi.fn(),
    });

    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText(/Position closed successfully/)).toBeInTheDocument();
    });
  });

  it('shows error state on transaction failure', async () => {
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'error',
      txError: 'rejected',
      txHash: null,
      removeLiquidity: vi.fn(),
      collectFees: vi.fn(),
      reset: vi.fn(),
    });

    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText('Transaction rejected in wallet.')).toBeInTheDocument();
    });
  });

  it('disables remove button while signing or submitting', async () => {
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'signing',
      txError: null,
      txHash: null,
      removeLiquidity: vi.fn(),
      collectFees: vi.fn(),
      reset: vi.fn(),
    });

    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      const removeButton = screen.getByText('Waiting for signature…');
      expect(removeButton).toBeDisabled();
    });
  });

  it('navigates to portfolio after 100% removal success', async () => {
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'success',
      txError: null,
      txHash: 'abc123',
      removeLiquidity: vi.fn(),
      collectFees: vi.fn(),
      reset: vi.fn(),
    });

    const RemoveLiquidityPage = await importPage();
    render(<RemoveLiquidityPage params={Promise.resolve({ id: 'pos-1' })} />);

    await waitFor(() => {
      expect(screen.getByText(/Redirecting to portfolio/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
