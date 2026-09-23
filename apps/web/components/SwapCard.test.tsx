import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SwapCard } from './SwapCard';

const mockUseWallet = vi.fn();

vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockUseWallet(),
}));

vi.mock('./SwapWidget', () => ({
  SwapWidget: ({ wallet }: { wallet: { address: string | null } }) => (
    <div data-testid="swap-widget">
      SwapWidget:{wallet.address ?? 'disconnected'}
    </div>
  ),
}));

describe('SwapCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWallet.mockReturnValue({ address: 'GTEST' });
  });

  it('renders SwapWidget with the connected wallet address', () => {
    render(<SwapCard />);
    expect(screen.getByTestId('swap-widget')).toHaveTextContent('SwapWidget:GTEST');
  });

  it('passes a null address when the wallet is disconnected', () => {
    mockUseWallet.mockReturnValue({ address: null });
    render(<SwapCard />);
    expect(screen.getByTestId('swap-widget')).toHaveTextContent('SwapWidget:disconnected');
  });
});
