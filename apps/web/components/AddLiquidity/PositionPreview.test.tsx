import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PositionPreview, type PositionPreviewProps } from './PositionPreview';
import { FEE_APR_DOC_URL } from '@/lib/constants';

function baseProps(overrides: Partial<PositionPreviewProps> = {}): PositionPreviewProps {
  return {
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    amount0: '100',
    amount1: '10',
    lowerPrice: '0.09',
    upperPrice: '0.11',
    shareOfPool: '0.5',
    estimatedApr: '12.4',
    inRange: true,
    currentPrice: 0.1,
    txStatus: 'idle',
    txError: null,
    txHash: null,
    positionNftId: null,
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    isWalletConnected: true,
    ...overrides,
  };
}

describe('PositionPreview - estimated fees APR', () => {
  it('shows the APR percentage when data is available', () => {
    render(<PositionPreview {...baseProps({ estimatedApr: '12.4' })} />);
    expect(screen.getByText('12.4%')).toBeInTheDocument();
  });

  it('shows N/A instead of a misleading percentage when APR data is missing', () => {
    render(<PositionPreview {...baseProps({ estimatedApr: 'N/A' })} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.queryByText('N/A%')).not.toBeInTheDocument();
  });

  it('links the APR assumptions to the fee APR calculation doc', () => {
    render(<PositionPreview {...baseProps()} />);
    const link = screen.getByLabelText('Fee APR calculation assumptions');
    expect(link).toHaveAttribute('href', FEE_APR_DOC_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
