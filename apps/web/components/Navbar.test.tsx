import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from './Navbar';

// Mock Next.js Link so we don't need a router context in tests
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

// WalletButton has its own context — stub it out for layout-only tests
vi.mock('./WalletButton', () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));

function renderNavbar() {
  return render(<Navbar />);
}

describe('Navbar', () => {
  describe('desktop rendering', () => {
    it('renders the Swyft logo link', () => {
      renderNavbar();
      expect(screen.getByRole('link', { name: 'Swyft' })).toBeInTheDocument();
    });

    it('renders nav links for Swap, History, Portfolio', () => {
      renderNavbar();
      expect(screen.getByRole('link', { name: 'Swap' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Portfolio' })).toBeInTheDocument();
    });

    it('renders the wallet button', () => {
      renderNavbar();
      expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    });
  });

  describe('mobile hamburger menu', () => {
    it('renders the hamburger button', () => {
      renderNavbar();
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    });

    it('mobile nav is hidden by default', () => {
      renderNavbar();
      expect(screen.queryByRole('navigation', { name: 'mobile-nav' })).not.toBeInTheDocument();
      // The mobile nav links are in the dropdown which is not rendered initially
      const mobileLinks = screen.queryAllByRole('link', { name: 'Swap' });
      // Only the desktop link should be visible (one instance)
      expect(mobileLinks).toHaveLength(1);
    });

    it('opens mobile menu when hamburger is clicked', () => {
      renderNavbar();
      const hamburger = screen.getByRole('button', { name: 'Open menu' });
      fireEvent.click(hamburger);
      // After opening, the mobile dropdown adds more link instances
      const swapLinks = screen.getAllByRole('link', { name: 'Swap' });
      expect(swapLinks.length).toBeGreaterThan(1);
    });

    it('hamburger button aria-expanded is false when closed', () => {
      renderNavbar();
      const hamburger = screen.getByRole('button', { name: 'Open menu' });
      expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    });

    it('hamburger button aria-expanded is true when open', () => {
      renderNavbar();
      const hamburger = screen.getByRole('button', { name: 'Open menu' });
      fireEvent.click(hamburger);
      expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });

    it('closes mobile menu when hamburger is clicked again', () => {
      renderNavbar();
      const hamburger = screen.getByRole('button', { name: 'Open menu' });
      fireEvent.click(hamburger);
      const closeBtn = screen.getByRole('button', { name: 'Close menu' });
      fireEvent.click(closeBtn);
      // Back to closed state — only desktop links remain
      expect(screen.getAllByRole('link', { name: 'Swap' })).toHaveLength(1);
    });

    it('closes mobile menu when a nav link is clicked', () => {
      renderNavbar();
      const hamburger = screen.getByRole('button', { name: 'Open menu' });
      fireEvent.click(hamburger);
      // Click the Swap link inside the mobile dropdown (second occurrence)
      const swapLinks = screen.getAllByRole('link', { name: 'Swap' });
      fireEvent.click(swapLinks[swapLinks.length - 1]);
      // Menu should now be closed — only the desktop link remains
      expect(screen.getAllByRole('link', { name: 'Swap' })).toHaveLength(1);
    });

    it('hamburger button has accessible label', () => {
      renderNavbar();
      const btn = screen.getByRole('button', { name: 'Open menu' });
      expect(btn).toHaveAttribute('aria-label', 'Open menu');
      expect(btn).toHaveAttribute('aria-controls', 'mobile-nav');
    });
  });

  describe('accessibility', () => {
    it('nav element has accessible label', () => {
      renderNavbar();
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    });

    it('mobile menu links have minimum touch target height class', () => {
      renderNavbar();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      // All mobile menu links should have min-h-[44px] for touch targets
      const mobileSwapLinks = screen.getAllByRole('link', { name: 'Swap' });
      const mobileLink = mobileSwapLinks[mobileSwapLinks.length - 1];
      expect(mobileLink.className).toContain('min-h-[44px]');
    });
  });
});
