import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';
import { Input } from '../Input';
import { SlippagePanel } from '../SlippagePanel';
import { SwapInput } from '../SwapInput';
import { TokenPairSelector } from '../TokenPairSelector';
import { TokenSelectorModal } from '../TokenSelectorModal';
import type { Token } from '../types';

const TOKENS: Token[] = [
  { id: 'XLM', symbol: 'XLM', name: 'Stellar Lumens', logoUrl: null },
  { id: 'USDC', symbol: 'USDC', name: 'USD Coin', logoUrl: null },
];

describe('@swyft/ui accessibility', () => {
  it('generates unique, stable input IDs and keeps caller descriptions', () => {
    render(
      <>
        <span id="amount-help">Available balance</span>
        <Input label="Amount" hint="Enter an amount" aria-describedby="amount-help" />
        <Input label="Amount" />
      </>
    );

    const inputs = screen.getAllByLabelText('Amount');
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0]).toHaveAccessibleDescription('Available balance Enter an amount');
    expect(inputs[1].id).toBeTruthy();
  });

  it('associates each swap amount with its own label and error message', () => {
    render(
      <>
        <SwapInput label="Input" token={null} amount="11" balance="10" />
        <SwapInput label="Output" token={null} amount="0" />
      </>
    );

    const input = screen.getByLabelText('Input amount');
    expect(input.id).not.toBe(screen.getByLabelText('Output amount').id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Insufficient balance');
  });

  it('moves focus from token search into the token list and exposes selection state', async () => {
    const user = userEvent.setup();
    render(
      <TokenSelectorModal
        label="Input token"
        tokens={TOKENS}
        selected={TOKENS[0]}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Input token: XLM' }));
    const search = screen.getByRole('searchbox', { name: 'Search tokens' });
    expect(search).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    const tokenList = screen.getByRole('list', { name: 'Input token' });
    expect(within(tokenList).getByRole('button', { name: /xlm/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(tokenList).getByRole('button', { name: /usdc/i })).toHaveFocus();
  });

  it('gives the slippage controls an expanded state and selected preset state', async () => {
    const user = userEvent.setup();
    render(<SlippagePanel slippageBps={100} onChange={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /slippage tolerance/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const panel = screen.getByRole('group', { name: 'Slippage tolerance' });
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByRole('button', { name: '1%' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps the button label available to assistive technology while loading', () => {
    render(<Button loading>Submit swap</Button>);

    const button = screen.getByRole('button', { name: /loading submit swap/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('uses a non-submit button for swapping token direction', () => {
    render(
      <TokenPairSelector
        pair={{ tokenIn: TOKENS[0], tokenOut: TOKENS[1] }}
        tokens={TOKENS}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Swap token pair direction' })).toHaveAttribute(
      'type',
      'button'
    );
  });
});
