/**
 * SwapWidget — responsive layout and accessibility tests.
 *
 * These tests verify that the swap widget correctly renders its responsive
 * structure, accessible touch targets, token picker backdrop, and loading /
 * error / empty states on all viewport sizes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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
  usePoolId: () => ({ poolId: 'CPOOL', poolExists: true, feeTier: 30 }),
}));

const mockQuote = {
  amountOut: '95',
  priceImpact: 0.5,
  lpFee: '0.3',
  protocolFee: '0',
  minimumReceived: '94.5',
  executionPrice: '0.95',
};

vi.mock('@/hooks/useSwapQuote', () => ({
  useSwapQuote: vi.fn(() => ({ quote: mockQuote, loading: false })),
}));

vi.mock('@/hooks/useWalletBalances', () => ({
  useWalletBalances: () => ({}),
}));

// SwapConfirmModal is rendered for real (not mocked away) so that the
// network-mismatch banner and retry logic it owns are exercised by these
// tests. Its own dependencies that reach the network / wallet extension are
// mocked instead.
const mockGetNetwork = vi.fn();
vi.mock('@stellar/freighter-api', () => ({
  getNetwork: (...args: unknown[]) => mockGetNetwork(...args),
  signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ hash: 'tx-hash' }),
}) as unknown as typeof fetch;

vi.mock('@swyft/ui', () => ({
  SwapInput: ({
    label,
    amount,
    onAmountChange,
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
      <input
        aria-label={label}
        value={amount}
        onChange={(e) => onAmountChange?.(e.target.value)}
      />
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
      const btn = screen.getByRole('button', { name: 'Connect wallet to swap' });
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

  // ── Confirmation modal (real SwapConfirmModal, not mocked away) ──────────
  //
  // These tests exercise the actual SwapConfirmModal that SwapWidget renders
  // on swap — including the network-mismatch banner and retry logic — rather
  // than a stub, so a regression in that wiring shows up here.

  describe('confirmation modal', () => {
    async function selectPairAndEnterAmount() {
      renderWidget(connectedWallet);

      const [payPicker, receivePicker] = screen.getAllByRole('button', { name: /Select/ });
      fireEvent.click(payPicker);
      fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
      fireEvent.click(receivePicker);
      fireEvent.click(screen.getByRole('button', { name: 'XLM' }));

      const payInput = screen.getByLabelText('You pay');
      fireEvent.change(payInput, { target: { value: '100' } });
    }

    beforeEach(() => {
      mockGetNetwork.mockResolvedValue({ network: 'TESTNET' });
    });

    it('opens the real SwapConfirmModal (not a stub) when the swap button is clicked', async () => {
      await selectPairAndEnterAmount();

      const swapButton = screen.getByRole('button', { name: 'Swap' });
      expect(swapButton).not.toBeDisabled();
      fireEvent.click(swapButton);

      expect(await screen.findByRole('dialog', { name: 'Confirm swap' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Confirm swap' })).toBeInTheDocument();
      // Confirms the real modal renders its own fee breakdown from the quote,
      // not a "Confirm" placeholder from a mock.
      expect(screen.getByText('Price impact')).toBeInTheDocument();
      expect(screen.getByText('Min. received')).toBeInTheDocument();
    });

    it('shows the network-mismatch banner and disables confirm when the wallet is on a different network', async () => {
      mockGetNetwork.mockResolvedValue({ network: 'PUBLIC' });
      await selectPairAndEnterAmount();

      fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
      await screen.findByRole('dialog', { name: 'Confirm swap' });

      await waitFor(() =>
        expect(screen.getByText(/wallet is on a different Stellar network/i)).toBeInTheDocument()
      );

      const confirmButton = screen.getByRole('button', { name: 'Confirm swap' });
      expect(confirmButton).toBeDisabled();
    });

    it('retries the swap after a network error via the modal\'s own retry button', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'tx failed' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ hash: 'retry-hash' }) });

      await selectPairAndEnterAmount();
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
      await screen.findByRole('dialog', { name: 'Confirm swap' });

      fireEvent.click(screen.getByRole('button', { name: 'Confirm swap' }));

      await screen.findByText(/Network error/i);

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(screen.getByText('Swap confirmed')).toBeInTheDocument());
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('closes the modal via the Done button after a successful swap', async () => {
      await selectPairAndEnterAmount();
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
      await screen.findByRole('dialog', { name: 'Confirm swap' });

      fireEvent.click(screen.getByRole('button', { name: 'Confirm swap' }));
      await waitFor(() => expect(screen.getByText('Swap confirmed')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Confirm swap' })).not.toBeInTheDocument()
      );
    });
  });
});
