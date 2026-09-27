'use client';

import { useState, useRef, useEffect } from 'react';
import { useWalletContext } from '@/context/WalletContext';
import { useNetworkContext } from '@/context/NetworkContext';
import type { WalletKind } from '@/hooks/useWallet';

function truncate(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ── Wallet option descriptors ─────────────────────────────────────────────────

interface WalletOption {
  kind: WalletKind;
  label: string;
  description: string;
  icon: React.ReactNode;
  installUrl: string;
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    kind: 'freighter',
    label: 'Freighter',
    description: 'Official Stellar browser extension',
    installUrl: 'https://freighter.app',
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        fill="none"
        className="h-6 w-6"
      >
        <rect width="32" height="32" rx="8" fill="#5F3DC4" />
        <path
          d="M8 16h16M16 8v16"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    kind: 'xbull',
    label: 'xBull',
    description: 'Feature-rich Stellar wallet',
    installUrl: 'https://xbull.app',
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        fill="none"
        className="h-6 w-6"
      >
        <rect width="32" height="32" rx="8" fill="#FF6B35" />
        <path
          d="M9 23L16 9l7 14H9z"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
];

// ── WalletSelectModal ─────────────────────────────────────────────────────────

interface WalletSelectModalProps {
  onSelect: (kind: WalletKind) => void;
  onClose: () => void;
  connecting: boolean;
  error: 'NOT_INSTALLED' | 'REJECTED' | 'WRONG_NETWORK' | 'UNSUPPORTED_WALLET' | null;
  activeKind: WalletKind;
  network: string;
}

function WalletSelectModal({
  onSelect,
  onClose,
  connecting,
  error,
  activeKind,
  network,
}: WalletSelectModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function errorFor(kind: WalletKind): string | null {
    if (activeKind !== kind) return null;
    if (error === 'NOT_INSTALLED')
      return `${kind === 'freighter' ? 'Freighter' : 'xBull'} is not installed.`;
    if (error === 'REJECTED') return 'Connection was rejected.';
    if (error === 'WRONG_NETWORK') return `Switch to ${network} in your wallet and try again.`;
    return null;
  }

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="wallet-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-white">
            Connect a wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet selector"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Wallet options */}
        <ul className="flex flex-col gap-2 p-4" role="list">
          {WALLET_OPTIONS.map((opt) => {
            const kindError = errorFor(opt.kind);
            const isActive = connecting && activeKind === opt.kind;

            return (
              <li key={opt.kind}>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => onSelect(opt.kind)}
                  aria-label={`Connect with ${opt.label}`}
                  aria-busy={isActive}
                  className="group flex w-full items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
                >
                  {opt.icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{opt.label}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{opt.description}</p>
                    {kindError && (
                      <p className="mt-1 text-xs text-red-500" role="alert">
                        {kindError}{' '}
                        <a
                          href={opt.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Install
                        </a>
                      </p>
                    )}
                  </div>
                  {isActive ? (
                    <svg
                      className="h-4 w-4 animate-spin text-indigo-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 text-zinc-300 group-hover:text-indigo-400 dark:text-zinc-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-zinc-100 px-5 py-3 text-center text-xs text-zinc-400 dark:border-zinc-800">
          By connecting, you agree to the{' '}
          <a
            href="https://github.com/Vatix-Protocol/Swyft/blob/main/docs/TERMS.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Terms of Service
          </a>
        </p>
      </div>
    </div>
  );
}

// ── WalletButton ──────────────────────────────────────────────────────────────

export function WalletButton() {
  const { address, error, connecting, loading, walletKind, connect, disconnect } = useWalletContext();
  const { network } = useNetworkContext();
  const [open, setOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the connected-wallet dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleWalletSelect(kind: WalletKind) {
    await connect(kind);
    // Close modal on success (error state is surfaced inside the modal)
    if (!error) setShowModal(false);
  }

  if (loading) {
    return (
      <div
        className="h-9 w-32 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700"
        aria-label="Loading wallet"
      />
    );
  }

  if (address) {
    const walletLabel = walletKind === 'xbull' ? 'xBull' : 'Freighter';

    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={`Connected wallet ${truncate(address)}`}
          className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
          title={address}
        >
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {truncate(address)}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-50">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Connected via <span className="font-medium text-zinc-700 dark:text-zinc-300">{walletLabel}</span>
              </p>
              <p className="mt-1 break-all text-xs font-mono text-zinc-800 dark:text-zinc-200">
                {address}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Network: <span className="font-medium">{network}</span>
              </p>
            </div>
            <div className="p-2 flex flex-col gap-1">
              <button
                onClick={copyAddress}
                aria-label="Copy wallet address to clipboard"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy address'}
              </button>
              <button
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Disconnected state ──────────────────────────────────────────────────────

  // Surface a WRONG_NETWORK error even when the modal is closed (e.g. after
  // the user closes the modal without re-connecting).
  const showNetworkError = error === 'WRONG_NETWORK' && !showModal;

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => setShowModal(true)}
          disabled={connecting}
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
        >
          {connecting ? 'Connecting…' : 'Connect wallet'}
        </button>

        {showNetworkError && (
          <p className="text-xs text-red-500" role="alert">
            Switch to <strong>{network}</strong> in your wallet and try again.
          </p>
        )}
      </div>

      {showModal && (
        <WalletSelectModal
          onSelect={handleWalletSelect}
          onClose={() => setShowModal(false)}
          connecting={connecting}
          error={error}
          activeKind={walletKind}
          network={network}
        />
      )}
    </>
  );
}
