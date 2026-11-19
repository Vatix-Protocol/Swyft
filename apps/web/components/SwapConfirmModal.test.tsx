import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SwapQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { SwapConfirmModal } from './SwapConfirmModal';

const mockExecution = vi.fn();

vi.mock('@/hooks/useSwapExecution', () => ({
  useSwapExecution: () => mockExecution(),
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ network: 'TESTNET' }),
}));

vi.mock('@stellar/freighter-api', () => ({
  getNetwork: vi.fn(async () => ({ network: 'TESTNET' })),
}));

const SLIPPAGE_COPY = /price moved beyond your slippage tolerance/i;

const tokenIn = { id: 'CUSDC', symbol: 'USDC' } as Token;
const tokenOut = { id: 'CXLM', symbol: 'XLM' } as Token;
const quote = {
  amountOut: '95',
  priceImpact: 0.5,
  lpFee: '0.3',
  protocolFee: '0',
  minimumReceived: '94.5',
  executionPrice: '0.95',
} as unknown as SwapQuote;

function renderWithError(error: string | null) {
  mockExecution.mockReturnValue({
    status: 'error',
    error,
    txHash: null,
    execute: vi.fn(),
    executeExactOutput: vi.fn(),
    reset: vi.fn(),
  });
  render(
    <SwapConfirmModal
      poolId="CPOOL"
      tokenIn={tokenIn}
      tokenOut={tokenOut}
      amountIn="100"
      quote={quote}
      walletAddress="GABC"
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
}

describe('SwapConfirmModal slippage error', () => {
  beforeEach(() => mockExecution.mockReset());

  it('shows the slippage copy when the error is "slippage"', () => {
    renderWithError('slippage');
    expect(screen.getByText(SLIPPAGE_COPY)).toBeInTheDocument();
  });

  it('does not show the slippage copy for a different error', () => {
    renderWithError('rejected');
    expect(screen.queryByText(SLIPPAGE_COPY)).not.toBeInTheDocument();
  });
});
