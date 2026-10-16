import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenLogo } from '../TokenLogo';
import type { Token } from '../types';

const baseToken: Token = {
  symbol: 'eth',
  logoUrl: 'https://example.com/eth.png',
} as Token;

describe('TokenLogo', () => {
  it('renders an img with the token symbol as alt and the requested size', () => {
    render(<TokenLogo token={baseToken} size={32} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/eth.png');
    expect(img).toHaveAttribute('alt', 'eth');
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '32');
  });

  it('renders an aria-hidden initials badge when logoUrl is null', () => {
    render(<TokenLogo token={{ ...baseToken, logoUrl: null }} size={24} />);

    const badge = screen.getByText('ET');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('produces a deterministic className for the same symbol', () => {
    const { container: first } = render(
      <TokenLogo token={{ ...baseToken, logoUrl: null }} size={24} />,
    );
    const { container: second } = render(
      <TokenLogo token={{ ...baseToken, logoUrl: null }} size={24} />,
    );

    const firstBadge = first.querySelector('[aria-hidden="true"]');
    const secondBadge = second.querySelector('[aria-hidden="true"]');

    expect(firstBadge).not.toBeNull();
    expect(secondBadge).not.toBeNull();
    expect(firstBadge?.className).toBe(secondBadge?.className);
  });
});
