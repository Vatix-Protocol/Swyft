/**
 * Integration test for remove liquidity flow
 * Tests the complete user flow from position loading to liquidity removal
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';

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
  estimateRemoveAmounts: vi.fn(() => ({ amount0: '10.5', amount1: '5.2' })),
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

async function importPage() {
  const mod = await import('../app/positions/[id]/remove/page');
  return mod.default;
}

/** React 19 `use()` reads fulfilled thenables synchronously when status is set. */
function fulfilledParams(id: string): Promise<{ id: string }> {
  const promise = Promise.resolve({ id }) as Promise<{ id: string }> & {
    status: 'fulfilled';
    value: { id: string };
  };
  promise.status = 'fulfilled';
  promise.value = { id };
  return promise;
}

function renderPage(Page: React.ComponentType<{ params: Promise<{ id: string }> }>) {
  return render(<Page params={fulfilledParams('pos-1')} />);
}

async function waitForRemoveButton(pct = 100) {
  const btn = await screen.findByRole('button', {
    name: new RegExp(`remove ${pct}% liquidity`, 'i'),
  });
  await waitFor(() => expect(btn).not.toBeDisabled());
  return btn;
}

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
    localStorage.setItem('swyft_auth_token', 'mock-token');
  });

  it('loads the remove liquidity page with position data', async () => {
    const RemoveLiquidityPage = await importPage();
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText('Remove liquidity')).toBeInTheDocument();
  });

  it('displays position details including price range and current price', async () => {
    const RemoveLiquidityPage = await importPage();
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText('Price range')).toBeInTheDocument();
    expect(screen.getByText('Current price')).toBeInTheDocument();
    expect(screen.getByText('Position value')).toBeInTheDocument();
  });

  it('shows uncollected fees with collect button', async () => {
    const RemoveLiquidityPage = await importPage();
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText('Uncollected fees')).toBeInTheDocument();
    expect(screen.getByText('Collect fees only')).toBeInTheDocument();
  });

  it('allows selecting preset percentages (25, 50, 75, 100)', async () => {
    const RemoveLiquidityPage = await importPage();
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText('25%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('calls removeLiquidity after confirmation', async () => {
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
    renderPage(RemoveLiquidityPage);

    fireEvent.click(await waitForRemoveButton());
    fireEvent.click(await screen.findByRole('button', { name: /confirm remove/i }));

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
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText(/Position closed successfully/)).toBeInTheDocument();
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
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText('Transaction rejected in wallet.')).toBeInTheDocument();
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
    renderPage(RemoveLiquidityPage);

    const removeButton = await screen.findByText('Waiting for signature…');
    expect(removeButton).toBeDisabled();
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
    renderPage(RemoveLiquidityPage);

    expect(await screen.findByText(/Redirecting to portfolio/)).toBeInTheDocument();
  });
});
