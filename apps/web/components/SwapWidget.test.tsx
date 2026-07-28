/**
 * SwapWidget — responsive layout and accessibility tests.
 *
 * These tests verify that the swap widget correctly renders its responsive
 * structure, accessible touch targets, token picker backdrop, and loading /
 * error / empty states on all viewport sizes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SwapWidget } from './SwapWidget';

// ── Module mocks ────────────────────────────────────────────────────────────

const mockUseTokens = vi.fn(() => ({
  tokens: [
    { id: 'CUSDC', symbol: 'USDC' },
    { id: 'CXLM', symbol: 'XLM' },
  ],
  loading: false,
  error: null,
}));

vi.mock('@/hooks/useTokens', () => ({
  useTokens: (...args: unknown[]) => mockUseTokens(...args),
  useRecentTokens: () => ({ recentIds: [], pushRecent: vi.fn() }),
  usePoolId: () => ({ poolId: 'CPOOL', poolExists: true }),
}));

vi.mock('@/hooks/useSwapQuote', () => ({
  useSwapQuote: vi.fn(() => ({ quote: null, loading: false })),
}));

vi.mock('@/hooks/useWalletBalances', () => ({
  useWalletBalances: () => ({}),
}));

vi.mock('@/components/SwapConfirmModal', () => ({
  SwapConfirmModal: () => <div data-testid="swap-confirm-modal">Confirm</div>,
}));

vi.mock('@swyft/ui', () => ({
  SwapInput: ({
    label,
    amount,
  }: {
    label: string;
    amount: string;
    token: unknown;
    balance?: string;
    readOnly?: boolean;
    onAmountChange?: (v: string) => void;
    onTokenClick?: () => void;
  }) => (
    <div data-testid={`swap-input-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <span>{label}</span>
      <span>{amount}</span>
    </div>
  ),
  PriceImpactBadge: ({ impact }: { impact: number }) => (
    <span data-testid="price-impact-badge">{impact}%</span>
  ),
  SlippagePanel: ({
    slippageBps,
    onChange,
  }: {
    slippageBps: number;
    onChange: (v: number) => void;
  }) => (
    <button type="button" data-testid="slippage-panel" onClick={() => onChange(100)}>
      {slippageBps} bps
    </button>
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const disconnectedWallet = { address: null };
const connectedWallet = {
  address: 'GWALLET000000000000000000000000000000000000000000000000000A',
};

function renderWidget(wallet = disconnectedWallet) {
  return render(<SwapWidget wallet={wallet} />);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SwapWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default token state for each test
    mockUseTokens.mockReturnValue({
      tokens: [
        { id: 'CUSDC', symbol: 'USDC' },
        { id: 'CXLM', symbol: 'XLM' },
      ],
      loading: false,
      error: null,
    });
  });

  // ── Structure & layout ──────────────────────────────────────────────────

  describe('layout structure', () => {
    it('renders a full-width container', () => {
      const { container } = renderWidget();
      const card = container.firstChild as HTMLElement;
      expect(card.className).toMatch(/w-full/);
    });

    it('applies md:w-[448px] for desktop sizing', () => {
      const { container } = renderWidget();
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('md:w-[448px]');
    });

    it('renders "Swap" heading', () => {
      renderWidget();
      expect(screen.getByRole('heading', { level: 2, name: 'Swap' })).toBeInTheDocument();
    });

    it('renders both swap inputs', () => {
      renderWidget();
      expect(screen.getByTestId('swap-input-you-pay')).toBeInTheDocument();
      expect(screen.getByTestId('swap-input-you-receive')).toBeInTheDocument();
    });

    it('renders the direction swap button with accessible label', () => {
      renderWidget();
      expect(
        screen.getByRole('button', { name: 'Swap token pair direction' })
      ).toBeInTheDocument();
    });

    it('direction swap button has 44px touch target (h-11 w-11)', () => {
      renderWidget();
      const btn = screen.getByRole('button', { name: 'Swap token pair direction' });
      expect(btn.className).toMatch(/h-11/);
      expect(btn.className).toMatch(/w-11/);
    });

    it('renders the slippage panel', () => {
      renderWidget();
      expect(screen.getByTestId('slippage-panel')).toBeInTheDocument();
    });
  });

  // ── Token picker ─────────────────────────────────────────────────────────

  describe('token picker', () => {
    it('renders two "Select" token picker buttons by default', () => {
      renderWidget();
      const selectBtns = screen.getAllByRole('button', { name: /Select/ });
      expect(selectBtns).toHaveLength(2);
    });

    it('opens the token list when a picker button is clicked', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);
      expect(screen.getByRole('listbox', { name: 'Select token' })).toBeInTheDocument();
    });

    it('renders a backdrop overlay when the picker is open', () => {
      const { container } = renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);
      // The backdrop is a fixed inset-0 div with aria-hidden="true"
      const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
      expect(backdrop).toBeInTheDocument();
    });

    it('closes the picker when the backdrop is clicked', () => {
      const { container } = renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);
      expect(screen.getByRole('listbox', { name: 'Select token' })).toBeInTheDocument();

      const backdrop = container.querySelector(
        '[aria-hidden="true"].fixed.inset-0'
      ) as Element;
      fireEvent.click(backdrop);
      expect(screen.queryByRole('listbox', { name: 'Select token' })).not.toBeInTheDocument();
    });

    it('token picker button has aria-haspopup="listbox"', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      expect(firstPicker).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('token picker button has aria-expanded=false when closed', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      expect(firstPicker).toHaveAttribute('aria-expanded', 'false');
    });

    it('token picker button has aria-expanded=true when open', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);
      expect(firstPicker).toHaveAttribute('aria-expanded', 'true');
    });

    it('token list items have minimum 44px touch target', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);

      const listbox = screen.getByRole('listbox', { name: 'Select token' });
      const tokenBtns = within(listbox).getAllByRole('button');
      tokenBtns.forEach((btn) => {
        expect(btn.className).toContain('min-h-[44px]');
      });
    });

    it('selects a token and closes the picker', () => {
      renderWidget();
      const [firstPicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(firstPicker);

      const usdcOption = screen.getByRole('button', { name: 'USDC' });
      fireEvent.click(usdcOption);

      expect(screen.queryByRole('listbox', { name: 'Select token' })).not.toBeInTheDocument();
    });
  });

  // ── CTA button states ─────────────────────────────────────────────────────

  describe('swap button', () => {
    it('shows "Connect wallet to swap" when wallet is disconnected', () => {
      renderWidget(disconnectedWallet);
      expect(
        screen.getByRole('button', { name: 'Connect wallet to swap' })
      ).toBeInTheDocument();
    });

    it('shows "Select tokens" when wallet is connected but no tokens chosen', () => {
      renderWidget(connectedWallet);
      expect(screen.getByRole('button', { name: 'Select tokens' })).toBeInTheDocument();
    });

    it('swap button has enlarged touch target on mobile (min-h-[52px])', () => {
      renderWidget();
      const btn = screen.getByRole('button', {
        name: /Connect wallet|Select tokens|Swap|Enter/,
      });
      expect(btn.className).toContain('min-h-[52px]');
    });

    it('swap button is disabled when wallet is disconnected', () => {
      renderWidget(disconnectedWallet);
      const btn = screen.getByRole('button', { name: 'Connect wallet to swap' });
      expect(btn).toBeDisabled();
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  describe('loading skeleton', () => {
    it('renders loading skeleton when tokens are loading', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: true, error: null });
      const { container } = renderWidget();
      const skeleton = container.querySelector('[aria-busy="true"]');
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute('aria-label', 'Loading swap widget');
    });

    it('loading skeleton has responsive width classes', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: true, error: null });
      const { container } = renderWidget();
      const skeleton = container.querySelector('[aria-busy="true"]') as HTMLElement;
      expect(skeleton.className).toContain('w-full');
      expect(skeleton.className).toContain('md:w-[448px]');
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────

  describe('error state', () => {
    it('renders error alert when tokens fail to load', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: false, error: 'fetch_error' });
      renderWidget();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Unable to load tokens')).toBeInTheDocument();
    });

    it('error container has responsive width classes', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: false, error: 'fetch_error' });
      const { container } = renderWidget();
      const alert = container.querySelector('[role="alert"]') as HTMLElement;
      expect(alert.className).toContain('w-full');
      expect(alert.className).toContain('md:w-[448px]');
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders empty state when no tokens are available', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: false, error: null });
      renderWidget();
      expect(screen.getByText('No tokens available')).toBeInTheDocument();
    });

    it('empty state container has responsive width classes', () => {
      mockUseTokens.mockReturnValueOnce({ tokens: [], loading: false, error: null });
      const { container } = renderWidget();
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('w-full');
      expect(card.className).toContain('md:w-[448px]');
    });
  });
});
