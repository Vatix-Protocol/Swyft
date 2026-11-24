import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmountInputs, parseAmountToBaseUnits } from '@/components/AddLiquidity/AmountInputs';

function renderWith(amount0: string, balance0: string) {
  return render(
    <AmountInputs
      token0Symbol="XLM"
      token1Symbol="USDC"
      amount0={amount0}
      amount1=""
      balance0={balance0}
      token0Only
      onAmount0Change={vi.fn()}
      onAmount1Change={vi.fn()}
    />
  );
}

describe('AmountInputs — over-balance check', () => {
  // 2^53 + 1: not a safe integer, so parseFloat would round it to 2^53.
  const balance = '9007199254740993';

  it('allows an amount equal to the balance', () => {
    renderWith(balance, balance);
    expect(screen.queryByText('Insufficient balance')).not.toBeInTheDocument();
  });

  it('blocks an amount one base unit over the balance', () => {
    renderWith('9007199254740994', balance);
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('compares fractional amounts exactly', () => {
    const { unmount } = renderWith('1.0000001', '1.0000001');
    expect(screen.queryByText('Insufficient balance')).not.toBeInTheDocument();
    unmount();
    renderWith('1.0000002', '1.0000001');
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('parses balances with 18 fractional digits exactly', () => {
    const balance = '0.123456789012345678';
    expect(parseAmountToBaseUnits(balance)).toBe(123456789012345678n);
    expect(parseAmountToBaseUnits('0.123456789012345679')).toBe(123456789012345679n);
  });

  it('does not warn when an 18-decimal amount equals its balance', () => {
    renderWith('0.123456789012345678', '0.123456789012345678');
    expect(screen.queryByText('Insufficient balance')).not.toBeInTheDocument();
  });

  it('warns when an 18-decimal amount is one base unit above its balance', () => {
    renderWith('0.123456789012345679', '0.123456789012345678');
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });
});
