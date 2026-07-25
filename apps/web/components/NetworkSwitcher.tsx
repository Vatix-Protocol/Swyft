'use client';

import { useRef, useState, useEffect } from 'react';
import { useNetworkContext } from '@/context/NetworkContext';
import { useWalletContext } from '@/context/WalletContext';
import type { StellarNetwork } from '@/lib/constants';

const NETWORKS: { value: StellarNetwork; label: string }[] = [
  { value: 'TESTNET', label: 'Testnet' },
  { value: 'PUBLIC', label: 'Mainnet' },
];

export function NetworkSwitcher() {
  const { network, setNetwork } = useNetworkContext();
  const { address, disconnect } = useWalletContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function selectNetwork(next: StellarNetwork) {
    setOpen(false);
    if (next === network) return;
    // A wallet session validated against the old network is no longer
    // trustworthy once the app targets a different one — drop it instead
    // of leaving a stale, potentially mismatched connection in place.
    if (address) disconnect();
    setNetwork(next);
  }

  const isMainnet = network === 'PUBLIC';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 transition-colors min-h-[36px]"
      >
        <span
          className={`h-2 w-2 rounded-full ${isMainnet ? 'bg-emerald-500' : 'bg-amber-500'}`}
          aria-hidden="true"
        />
        {isMainnet ? 'Mainnet' : 'Testnet'}
        <svg
          className="h-3.5 w-3.5 text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Select network"
          className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {NETWORKS.map((n) => (
            <li key={n.value} role="option" aria-selected={n.value === network}>
              <button
                type="button"
                onClick={() => selectNetwork(n.value)}
                className="flex w-full min-h-[44px] items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span
                  className={`h-2 w-2 rounded-full ${n.value === 'PUBLIC' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  aria-hidden="true"
                />
                {n.label}
                {n.value === network && <span className="ml-auto text-xs text-zinc-400">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
