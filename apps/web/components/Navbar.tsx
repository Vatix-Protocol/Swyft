'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';

const NAV_LINKS = [
  { href: '/', label: 'Swap' },
  { href: '/history', label: 'History' },
  { href: '/portfolio', label: 'Portfolio' },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav
      className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80"
      aria-label="Main navigation"
    >
      {/* Primary bar */}
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Left: logo + desktop links */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white hover:opacity-80 transition-opacity"
          >
            Swyft
          </Link>
          {/* Desktop nav links — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-4">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right: wallet + hamburger */}
        <div className="flex items-center gap-3">
          <WalletButton />
          {/* Hamburger — visible only on mobile */}
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex sm:hidden h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {menuOpen ? (
              /* X icon */
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              /* Hamburger icon */
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          id="mobile-nav"
          className="sm:hidden border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-black px-4 py-3 flex flex-col gap-1"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className="min-h-[44px] flex items-center rounded-lg px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
