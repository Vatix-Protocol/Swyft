import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TokenSelector } from '@swyft/ui';

const tokens = [
  { id: 'USDC', symbol: 'USDC', name: 'USD Coin' },
  { id: 'XLM', symbol: 'XLM', name: 'Stellar Lumens' },
];

describe('TokenSelectorModal', () => {
  it('renders the trigger button and opens the modal', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <TokenSelector
        label="Input token"
        tokens={tokens}
        selected={null}
        onSelect={onSelect}
      />
    );

    const trigger = screen.getByRole('button', { name: /input token/i });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);

    const searchInput = screen.getByRole('searchbox', { name: /search tokens/i });
    expect(searchInput).toBeInTheDocument();

    const option = screen.getByRole('button', { name: /usdc/i });
    expect(option).toBeInTheDocument();

    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(tokens[0]);
  });

  it('disables the trigger and shows a loading indicator when loading', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <TokenSelector
        label="Output token"
        tokens={tokens}
        selected={null}
        loading
        onSelect={onSelect}
      />
    );

    const trigger = screen.getByRole('button', { name: /output token/i });
    expect(trigger).toBeDisabled();
    await user.click(trigger);

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
