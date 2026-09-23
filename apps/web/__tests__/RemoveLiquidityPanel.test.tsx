/**
 * Tests for apps/web/components/RemoveLiquidityPanel.tsx
 *
 * Strategy:
 * - Mock the remove-liquidity hook and SDK estimate helpers so tests are pure unit tests
 * - Cover: confirm summary appears before the wallet prompt, cancel dismisses it,
 *   confirming triggers removeLiquidity, and adjusting the amount resets confirmation
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';
import { RemoveLiquidityPanel } from '../components/RemoveLiquidityPanel';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@swyft/sdk', () => ({
  estimateRemoveAmounts: vi.fn(() => ({ amount0: '1.5', amount1: '2.5' })),
  estimateRemoveAmountsAsync: vi.fn(() =>
    Promise.resolve({ amount0: '1.5', amount1: '2.5' })
  ),
}));

const mockRemoveLiquidity = vi.fn();
const mockCollectFees = vi.fn();
const mockReset = vi.fn();
const mockUseRemoveLiquidity = vi.fn();

vi.mock('@/hooks/useRemoveLiquidity', () => ({
  useRemoveLiquidity: (...args: unknown[]) => mockUseRemoveLiquidity(...args),
}));

function makePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'pos-1',
    ownerWallet: 'GTEST',
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
    ...overrides,
  };
}

describe('RemoveLiquidityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRemoveLiquidity.mockReturnValue({
      status: 'idle',
      txError: null,
      txHash: null,
      removeLiquidity: mockRemoveLiquidity,
      collectFees: mockCollectFees,
      reset: mockReset,
    });
  });

  function renderPanel() {
    return render(
      <RemoveLiquidityPanel
        position={makePosition()}
        token0Symbol="XLM"
        token1Symbol="USDC"
        authToken="mock-token"
      />
    );
  }

  async function clickRemove(pct = 100) {
    const removeBtn = await screen.findByRole('button', {
      name: new RegExp(`remove ${pct}% liquidity`, 'i'),
    });
    await waitFor(() => expect(removeBtn).not.toBeDisabled());
    fireEvent.click(removeBtn);
    return removeBtn;
  }

  it('shows a confirmation summary before removeLiquidity is called', async () => {
    renderPanel();
    await clickRemove();

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: /confirm liquidity removal/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Confirm removal of 100% liquidity')).toBeInTheDocument();
    expect(mockRemoveLiquidity).not.toHaveBeenCalled();
  });

  it('displays estimated amounts in the confirmation summary', async () => {
    renderPanel();
    await clickRemove();

    const dialog = await screen.findByRole('alertdialog', {
      name: /confirm liquidity removal/i,
    });
    expect(dialog).toHaveTextContent('1.5');
    expect(dialog).toHaveTextContent('2.5');
  });

  it('does not submit the transaction until the user confirms', async () => {
    renderPanel();
    await clickRemove();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm remove/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    expect(mockRemoveLiquidity).toHaveBeenCalledWith(100);
  });

  it('dismisses the summary and skips the transaction when cancelled', async () => {
    renderPanel();
    await clickRemove();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockRemoveLiquidity).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /remove 100% liquidity/i })
    ).toBeInTheDocument();
  });

  it('resets confirmation when the removal percentage changes', async () => {
    renderPanel();
    await clickRemove();
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '50%' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockRemoveLiquidity).not.toHaveBeenCalled();
  });
});
