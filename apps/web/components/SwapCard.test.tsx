import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwapCard } from './SwapCard';

// ─── Mock hooks ────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockReset = vi.fn();

// These variables are closed over by the mock factory; reassigning them
// lets individual test groups change the returned state without re-mocking.
let mockStatus: string = 'idle';
let mockError: string | null = null;
let mockTxHash: string | null = null;

vi.mock('../hooks/useMevProtection', () => ({
  useMevProtection: () => ({
    enabled: false,
    rpcUrl: 'https://example.com/rpc',
  }),
}));

vi.mock('../hooks/useSwapExecution', () => ({
  useSwapExecution: () => ({
    get status() {
      return mockStatus;
    },
    get error() {
      return mockError;
    },
    get txHash() {
      return mockTxHash;
    },
    execute: mockExecute,
    reset: mockReset,
  }),
}));

vi.mock('./SwapSettings', () => ({
  SwapSettings: () => <div data-testid="swap-settings">Swap Settings</div>,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderSwapCard() {
  return render(<SwapCard />);
}

function getSwapButton() {
  return screen.getByRole('button', { name: /^(?:Swap|Swapping\.\.\.|Close)$/ });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SwapCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'idle';
    mockError = null;
    mockTxHash = null;
  });

  describe('rendering', () => {
    it('renders the Swap heading', () => {
      renderSwapCard();
      expect(screen.getByText('Swap')).toBeInTheDocument();
    });

    it('renders token input placeholders', () => {
      renderSwapCard();
      expect(screen.getByText('From token…')).toBeInTheDocument();
      expect(screen.getByText('To token…')).toBeInTheDocument();
    });

    it('renders the settings button', () => {
      renderSwapCard();
      const settingsBtn = screen.getByLabelText('Swap settings');
      expect(settingsBtn).toBeInTheDocument();
    });

    it('renders the Swap button', () => {
      renderSwapCard();
      expect(getSwapButton()).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockStatus = 'signing';
      mockError = null;
      mockTxHash = null;
    });

    it('disables submit button while loading', () => {
      renderSwapCard();
      const btn = getSwapButton();
      expect(btn).toBeDisabled();
    });

    it('shows signing state message', () => {
      renderSwapCard();
      expect(screen.getByText('Waiting for signature…')).toBeInTheDocument();
    });

    it('disables settings button during swap', () => {
      renderSwapCard();
      const settingsBtn = screen.getByLabelText('Swap settings');
      expect(settingsBtn).toBeDisabled();
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      mockStatus = 'error';
      mockError = 'slippage';
      mockTxHash = null;
    });

    it('shows slippage error message', () => {
      renderSwapCard();
      expect(screen.getByText(/price moved beyond your slippage tolerance/)).toBeInTheDocument();
    });

    it('shows retry button on slippage error', () => {
      renderSwapCard();
      const retryBtn = screen.getByRole('button', { name: 'Retry' });
      expect(retryBtn).toBeInTheDocument();
    });

    it('calls reset on retry', () => {
      renderSwapCard();
      const retryBtn = screen.getByRole('button', { name: 'Retry' });
      fireEvent.click(retryBtn);
      expect(mockReset).toHaveBeenCalled();
    });

    it('shows network error for network failures', () => {
      mockError = 'network';
      renderSwapCard();
      expect(screen.getByText(/Network error.*could not be submitted/)).toBeInTheDocument();
    });
  });

  describe('success state', () => {
    beforeEach(() => {
      mockStatus = 'success';
      mockError = null;
      mockTxHash = '0x1234567890abcdef';
    });

    it('shows success message with tx hash', () => {
      renderSwapCard();
      expect(screen.getByText('Transaction submitted successfully')).toBeInTheDocument();
      // The tx hash is rendered as "0x123456…90abcdef" split across DOM text nodes
      expect(screen.getByText(/0x123456/)).toBeInTheDocument();
      expect(screen.getByText(/90abcdef/)).toBeInTheDocument();
    });

    it('changes title to "Swap complete" on success', () => {
      renderSwapCard();
      expect(screen.getByText('Swap complete')).toBeInTheDocument();
    });

    it('changes button to "Close" on success', () => {
      renderSwapCard();
      const btn = screen.getByRole('button', { name: 'Close' });
      expect(btn).toBeInTheDocument();
    });

    it('resets form when Close is clicked', () => {
      renderSwapCard();
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtn);
      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe('settings panel', () => {
    it('renders settings panel when button is clicked', () => {
      renderSwapCard();
      const settingsBtn = screen.getByLabelText('Swap settings');
      fireEvent.click(settingsBtn);
      expect(screen.getByTestId('swap-settings')).toBeInTheDocument();
    });

    it('hides settings panel when button is clicked again', () => {
      renderSwapCard();
      const settingsBtn = screen.getByLabelText('Swap settings');
      fireEvent.click(settingsBtn);
      expect(screen.getByTestId('swap-settings')).toBeInTheDocument();
      fireEvent.click(settingsBtn);
      expect(screen.queryByTestId('swap-settings')).not.toBeInTheDocument();
    });
  });
});
