import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmountInputs } from '@/components/AddLiquidity/AmountInputs';

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
});
