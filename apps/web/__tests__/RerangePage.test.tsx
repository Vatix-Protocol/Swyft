/**
 * Tests for apps/web/app/positions/[id]/rerange/page.tsx tick-spacing derivation.
 *
 * Strategy: mock position/wallet/rerange hooks and assert the initial tick
 * range snaps to the position's fee-tier spacing (not a hardcoded 60).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockUsePosition = vi.fn();

vi.mock('@/hooks/usePositions', () => ({
  usePosition: (...args: unknown[]) => mockUsePosition(...args),
}));

vi.mock('@/hooks/useRerangeLiquidity', () => ({
  useRerangeLiquidity: () => ({
    status: 'idle',
    txError: null,
    txHash: null,
    rerange: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: () => ({ signTransaction: vi.fn() }),
}));

vi.mock('@swyft/ui', () => ({
  PositionRangeBadge: () => <span data-testid="range-badge" />,
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

async function importPage() {
  const mod = await import('../app/positions/[id]/rerange/page');
  return mod.default;
}

function positionWithFeeTier(feeTier: string) {
  return {
    id: 'pos-1',
    ownerWallet: 'GTEST123',
    poolId: 'pool-1',
    token0: 'XLM',
    token1: 'USDC',
    lowerTick: 100,
    upperTick: 200,
    liquidity: '1000',
    currentValueUsd: 100,
    uncollectedFeesToken0: '0',
    uncollectedFeesToken1: '0',
    createdAt: 1,
    closedAt: null,
    status: 'active',
    poolCurrentPrice: 1.5,
    feeTier,
  };
}

function readTicks(): [number, number] {
  const el = screen.getByText(/Ticks:/);
  const match = el.textContent?.match(/Ticks:\s*(-?\d+)\s*–\s*(-?\d+)/);
  if (!match) throw new Error(`unparseable ticks text: ${el.textContent}`);
  return [Number(match[1]), Number(match[2])];
}

describe('RerangeLiquidityPage tick spacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem('swyft_auth_token', 'tok-123');
  });

  it('snaps the initial range to spacing 10 for a 0.05% position', async () => {
    mockUsePosition.mockReturnValue({
      position: positionWithFeeTier('0.05%'),
      loading: false,
      error: null,
    });
    const Page = await importPage();
    render(<Page params={Promise.resolve({ id: 'pos-1' })} />);

    const [lower, upper] = readTicks();
    expect(lower % 10).toBe(0);
    expect(upper % 10).toBe(0);
    // Would fail under the old hardcoded 60: 50 and 250 are not multiples of 60.
    expect([lower, upper]).toEqual([50, 250]);
  });

  it('snaps the initial range to spacing 200 for a 1.00% position', async () => {
    mockUsePosition.mockReturnValue({
      position: positionWithFeeTier('1.00%'),
      loading: false,
      error: null,
    });
    const Page = await importPage();
    render(<Page params={Promise.resolve({ id: 'pos-1' })} />);

    const [lower, upper] = readTicks();
    expect(lower % 200).toBe(0);
    expect(upper % 200).toBe(0);
    expect([lower, upper]).toEqual([-800, 1200]);
  });
});
