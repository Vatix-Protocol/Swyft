/**
 * Interaction coverage for the @swyft/ui swap suite.
 *
 * Covers user-facing behaviour of the three domain components that power the
 * swap flow:
 * - SwapInput: typing amounts, validation of numeric input, insufficient
 *   balance handling, max-balance shortcut, and read-only mode.
 * - SlippagePanel: toggling the panel open/closed, choosing a preset, entering
 *   a custom tolerance, and the high-slippage warning.
 * - TokenSelectorModal: opening the Radix dialog, searching the token list,
 *   selecting a token, and the loading state.
 */

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SwapInput } from '../SwapInput';
import { SlippagePanel } from '../SlippagePanel';
import { TokenSelectorModal } from '../TokenSelectorModal';
import type { Token } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOKENS: Token[] = [
  { id: 'XLM', symbol: 'XLM', name: 'Stellar Lumens', logoUrl: null },
  { id: 'USDC', symbol: 'USDC', name: 'USD Coin', logoUrl: null },
  { id: 'ETH', symbol: 'ETH', name: 'Ethereum', logoUrl: null },
];

// SwapInput is fully controlled, so a tiny stateful wrapper lets us observe how
// user edits flow through onAmountChange back into `amount`.
function ControlledSwapInput(props: Partial<Parameters<typeof SwapInput>[0]>) {
  const [amount, setAmount] = useState('');
  return (
    <SwapInput label={props.label ?? 'Amount'} token={null} amount={amount} {...props} onAmountChange={setAmount} />
  );
}

// ─── SwapInput ────────────────────────────────────────────────────────────────

describe('SwapInput', () => {
  it('accepts a decimal amount typed by the user', async () => {
    const user = userEvent.setup();
    render(<ControlledSwapInput label="Amount in" />);

    const input = screen.getByLabelText('Amount in amount');
    await user.type(input, '12.5');

    expect(input).toHaveValue('12.5');
  });

  it('ignores non-numeric characters', async () => {
    const user = userEvent.setup();
    render(<ControlledSwapInput label="Amount in" />);

    const input = screen.getByLabelText('Amount in amount');
    await user.type(input, 'abc1-2');

    expect(input).toHaveValue('12');
  });

  it('reports insufficient balance when the amount exceeds the balance', async () => {
    const user = userEvent.setup();
    render(<ControlledSwapInput label="Amount in" balance="10" />);

    const input = screen.getByLabelText('Amount in amount');
    await user.type(input, '20');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient balance');
  });

  it('clears the insufficient-balance state once the amount is reduced', async () => {
    const user = userEvent.setup();
    render(<ControlledSwapInput label="Amount in" balance="10" />);

    const input = screen.getByLabelText('Amount in amount');
    await user.type(input, '200');

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '5');

    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the max balance when the balance button is clicked', async () => {
    const user = userEvent.setup();
    render(<ControlledSwapInput label="Amount in" balance="10.5" />);

    await user.click(screen.getByRole('button', { name: /use max balance/i }));

    expect(screen.getByLabelText('Amount in amount')).toHaveValue('10.5');
  });

  it('does not allow editing when read-only', async () => {
    const user = userEvent.setup();
    render(<SwapInput label="Amount out" token={null} amount="0.00" readOnly />);

    const input = screen.getByLabelText('Amount out amount');
    await user.type(input, '99');

    expect(input).toHaveValue('0.00');
  });

  it('fires onTokenClick when the token selector is clicked', async () => {
    const user = userEvent.setup();
    const onTokenClick = vi.fn();
    render(
      <SwapInput label="Amount in" token={TOKENS[0]} amount="0" onTokenClick={onTokenClick} />
    );

    await user.click(screen.getByRole('button', { name: /change/i }));

    expect(onTokenClick).toHaveBeenCalledTimes(1);
  });
});

// ─── SlippagePanel ────────────────────────────────────────────────────────────

// SlippagePanel is controlled through the `slippageBps` prop, so the parent
// must reflect onChange back for derived UI (like the high-slippage warning).
function ControlledSlippagePanel({ onChange }: { onChange: (bps: number) => void }) {
  const [bps, setBps] = useState(50);
  return (
    <SlippagePanel
      slippageBps={bps}
      onChange={(next) => {
        setBps(next);
        onChange(next);
      }}
    />
  );
}

describe('SlippagePanel', () => {
  it('toggles open and closed when the slippage button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SlippagePanel slippageBps={50} onChange={onChange} />);

    const toggle = screen.getByRole('button', { name: /slippage tolerance/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Slippage tolerance')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects a preset and reports its value in basis points', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SlippagePanel slippageBps={50} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /slippage tolerance/i }));
    await user.click(screen.getByRole('button', { name: '1%' }));

    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('accepts a valid custom tolerance in basis points', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SlippagePanel slippageBps={50} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /slippage tolerance/i }));
    await user.type(screen.getByLabelText('Custom slippage percentage'), '2.5');

    expect(onChange).toHaveBeenCalledWith(250);
  });

  it('shows a warning for a high custom tolerance', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSlippagePanel onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /slippage tolerance/i }));
    await user.clear(screen.getByLabelText('Custom slippage percentage'));
    await user.type(screen.getByLabelText('Custom slippage percentage'), '15');

    expect(onChange).toHaveBeenCalledWith(1500);
    expect(screen.getByText(/high slippage/i)).toBeInTheDocument();
  });
});

// ─── TokenSelectorModal ───────────────────────────────────────────────────────

describe('TokenSelectorModal', () => {
  it('opens the dialog and confirms the selected token', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TokenSelectorModal label="Input token" tokens={TOKENS} selected={null} onSelect={onSelect} />
    );

    await user.click(screen.getByRole('button', { name: /input token/i }));

    expect(screen.getByRole('searchbox', { name: /search tokens/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ethereum/i }));

    expect(onSelect).toHaveBeenCalledWith(TOKENS[2]);
  });

  it('filters tokens by symbol when searching', async () => {
    const user = userEvent.setup();
    render(
      <TokenSelectorModal
        label="Output token"
        tokens={TOKENS}
        selected={null}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /output token/i }));
    const search = screen.getByRole('searchbox', { name: /search tokens/i });

    await user.type(search, 'usdc');

    expect(screen.getByRole('button', { name: /usd coin/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stellar lumens/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ethereum/i })).not.toBeInTheDocument();
  });

  it('disables the trigger and does not open while loading', async () => {
    const user = userEvent.setup();
    render(
      <TokenSelectorModal
        label="Input token"
        tokens={TOKENS}
        selected={null}
        loading
        onSelect={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /input token/i });
    expect(trigger).toBeDisabled();

    await user.click(trigger);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('shows an empty state when no token matches the search', async () => {
    const user = userEvent.setup();
    render(
      <TokenSelectorModal
        label="Input token"
        tokens={TOKENS}
        selected={null}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /input token/i }));
    await user.type(screen.getByRole('searchbox', { name: /search tokens/i }), 'zzz');

    expect(screen.getByText('No tokens found')).toBeInTheDocument();
  });
});