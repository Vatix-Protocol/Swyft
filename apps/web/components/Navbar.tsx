'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WalletButton } from './WalletButton';
import { NetworkSwitcher } from './NetworkSwitcher';

const NAV_LINKS = [
  { href: '/swap', label: 'Swap' },
  { href: '/history', label: 'History' },
  { href: '/portfolio', label: 'Portfolio' },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const nav = navRef.current;
      if (nav && !nav.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <nav
      ref={navRef}
      aria-label="Main navigation"
      className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold text-white">
          Swyft
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-slate-300 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <NetworkSwitcher />
          <WalletButton />
        </div>

        <button
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-300 hover:text-white md:hidden"
        >
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          {menuOpen ? (
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {menuOpen && (
        <div id="mobile-nav" className="border-t border-slate-800 md:hidden">
          <div className="flex flex-col gap-1 px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[44px] items-center rounded-md px-3 text-sm text-slate-300 transition-colors hover:bg-slate-900 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center gap-3 px-3">
              <NetworkSwitcher />
              <WalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
