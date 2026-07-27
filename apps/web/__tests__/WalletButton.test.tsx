import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { WalletButton } from '@/components/WalletButton';
import type { WalletState } from '@/hooks/useWallet';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockDisconnect = vi.fn();
const mockConnect = vi.fn(async () => undefined);

const baseState: WalletState = {
  address: null,
  error: null,
  connecting: false,
  loading: false,
  connect: mockConnect,
  disconnect: mockDisconnect,
  signTransaction: null,
};

let walletState: WalletState = { ...baseState };

vi.mock('@/context/WalletContext', () => ({
  useWalletContext: () => walletState,
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ network: 'TESTNET' }),
}));

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('WalletButton', () => {
  beforeEach(() => {
    walletState = { ...baseState };
    vi.clearAllMocks();
  });

  it('shows "Connect wallet" when disconnected', () => {
    render(<WalletButton />);
    expect(screen.getByText('Connect wallet')).toBeDefined();
  });

  it('shows truncated address when connected', () => {
    walletState = { ...baseState, address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    render(<WalletButton />);
    expect(screen.getByText('GABC...WXYZ')).toBeDefined();
  });

  it('has an aria-label with the truncated address when connected', () => {
    walletState = { ...baseState, address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    render(<WalletButton />);
    const button = screen.getByLabelText('Connected wallet GABC...WXYZ');
    expect(button).toBeDefined();
  });

  it('copies address to clipboard when copy button is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    walletState = { ...baseState, address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };

    render(<WalletButton />);
    // Open dropdown
    fireEvent.click(screen.getByLabelText('Connected wallet GABC...WXYZ'));
    // Click copy
    fireEvent.click(screen.getByLabelText('Copy wallet address to clipboard'));

    expect(writeText).toHaveBeenCalledWith('GABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('shows "Copied!" text after copying', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    walletState = { ...baseState, address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };

    render(<WalletButton />);
    fireEvent.click(screen.getByLabelText('Connected wallet GABC...WXYZ'));
    fireEvent.click(screen.getByLabelText('Copy wallet address to clipboard'));

    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('shows "Connect wallet" when disconnected, not a truncated address', () => {
    walletState = { ...baseState, address: null };
    render(<WalletButton />);
    expect(screen.queryByLabelText(/Connected wallet/)).toBeNull();
    expect(screen.getByText('Connect wallet')).toBeDefined();
  });

  it('calls disconnect when Disconnect button is clicked', () => {
    walletState = { ...baseState, address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    render(<WalletButton />);

    fireEvent.click(screen.getByLabelText('Connected wallet GABC...WXYZ'));
    fireEvent.click(screen.getByText('Disconnect'));

    expect(mockDisconnect).toHaveBeenCalled();
  });
});
