import { describe, it, expect, vi } from 'vitest';
import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';

const usePoolDetail = vi.fn();
vi.mock('@/hooks/usePoolDetail', () => ({ usePoolDetail: () => usePoolDetail() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@swyft/ui', () => ({ TokenLogo: () => null }));

import PoolDetailPage from '@/app/pools/[id]/page';

const token = (symbol: string) => ({ address: `C${symbol}`, symbol, name: symbol, decimals: 7 });

function pool(overrides: Record<string, unknown>) {
  return {
    id: 'pool-1',
    token0: token('XLM'),
    token1: token('USDC'),
    feeTier: 30,
    currentSqrtPrice: '1',
    currentTick: 0,
    totalLiquidity: '0',
    tvl: '12.34',
    volume24h: '12.34',
    volume7d: '12.34',
    feeApr: '0',
    creationTimestamp: 0,
    recentSwaps: [],
    ...overrides,
  };
}

async function renderPage() {
  // Pre-resolved thenable so React's `use()` reads it synchronously.
  const value = { id: 'pool-1' };
  const params = Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
  render(
    <Suspense fallback={null}>
      <PoolDetailPage params={params} />
    </Suspense>
  );
  return screen.findByText('Total Value Locked');
}

describe('PoolDetailPage — price formatting', () => {
  it('renders a placeholder, not NaN, when a price is missing', async () => {
    usePoolDetail.mockReturnValue({
      data: pool({ tvl: undefined }),
      isLoading: false,
      isError: false,
    });
    const label = await renderPage();
    expect(label.nextElementSibling).toHaveTextContent('—');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders a decimal string as that decimal', async () => {
    usePoolDetail.mockReturnValue({ data: pool({}), isLoading: false, isError: false });
    const label = await renderPage();
    expect(label.nextElementSibling).toHaveTextContent('$12.34');
  });
});
