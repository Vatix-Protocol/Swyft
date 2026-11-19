/**
 * SwapWidget — default slippage renders the real SlippagePanel at 0.5%.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SwapWidget } from './SwapWidget';

vi.mock('@/hooks/useTokens', () => ({
  useTokens: () => ({
    tokens: [
      { id: 'CUSDC', symbol: 'USDC' },
      { id: 'CXLM', symbol: 'XLM' },
    ],
    loading: false,
    error: null,
  }),
  useRecentTokens: () => ({ recentIds: [], pushRecent: vi.fn() }),
  usePoolId: () => ({ poolId: 'CPOOL', poolExists: true, feeTier: 30 }),
}));

vi.mock('@/hooks/useSwapQuote', () => ({
  useSwapQuote: () => ({ quote: null, loading: false }),
}));

vi.mock('@/hooks/useWalletBalances', () => ({
  useWalletBalances: () => ({}),
}));

vi.mock('@stellar/freighter-api', () => ({
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

describe('SwapWidget default slippage', () => {
  it('shows 0.5% selected before the user clicks', () => {
    render(<SwapWidget wallet={{ address: null }} />);

    const toggle = screen.getByRole('button', { name: /slippage tolerance: 0\.5%/i });
    expect(toggle).toHaveTextContent('Slippage: 0.5%');
  });
});
