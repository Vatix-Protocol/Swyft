"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Token } from "./types";
import { TokenLogo } from "./TokenLogo";

interface Props {
  tokens: Token[];
  selected: Token | null;
  balances?: Record<string, string>;
  recentIds?: string[];
  loading?: boolean;
  onSelect: (token: Token) => void;
  label: string;
}

export function TokenSelectorModal({
  tokens,
  selected,
  balances = {},
  recentIds = [],
  loading = false,
  onSelect,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const q = query.toLowerCase();
  const filtered = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  );

  const recent = recentIds
    .map((id) => tokens.find((t) => t.id === id))
    .filter((t): t is Token => !!t && t.id !== selected?.id);

  const list: Token[] =
    q.length > 0
      ? filtered
      : [
          ...recent,
          ...filtered.filter((t) => !recentIds.includes(t.id)),
        ];

  function handleSelect(token: Token) {
    onSelect(token);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-token]");
    const focused = document.activeElement as HTMLElement;
    const idx = Array.from(items).indexOf(focused as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[Math.min(idx + 1, items.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx <= 0) inputRef.current?.focus();
      else items[idx - 1]?.focus();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          aria-label={`${label}: ${selected ? selected.symbol : "Select token"}`}
          className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:border-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white transition-colors min-w-[130px]"
        >
          {selected ? (
            <>
              <TokenLogo token={selected} size={20} />
              <span>{selected.symbol}</span>
            </>
          ) : (
            <span className="text-zinc-400">Select token</span>
          )}
          <svg
            className="ml-auto h-4 w-4 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white shadow-xl focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <VisuallyHidden asChild>
            <Dialog.Title>{label}</Dialog.Title>
          </VisuallyHidden>

          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <input
              ref={inputRef}
              type="search"
              placeholder="Search by name or symbol"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              aria-label="Search tokens"
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-label="Loading tokens" />
              </div>
            ) : list.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-400">No tokens found</p>
            ) : (
              <ul
                role="listbox"
                aria-label={label}
                onKeyDown={handleKeyDown}
                className="p-2"
              >
                {!q && recent.length > 0 && (
                  <li className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Recent
                  </li>
                )}
                {list.map((token, i) => {
                  const isRecent = !q && i < recent.length;
                  const isFirstNonRecent = !q && i === recent.length && recent.length > 0;
                  return (
                    <>
                      {isFirstNonRecent && (
                        <li key={`sep-${token.id}`} className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                          All tokens
                        </li>
                      )}
                      <li key={token.id} role="option" aria-selected={token.id === selected?.id}>
                        <button
                          data-token
                          onClick={() => handleSelect(token)}
                          disabled={token.id === selected?.id}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-zinc-100 focus:outline-none focus-visible:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 transition-colors"
                        >
                          <TokenLogo token={token} size={32} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-zinc-900 dark:text-white">{token.symbol}</p>
                            <p className="truncate text-xs text-zinc-400">{token.name}</p>
                          </div>
                          {balances[token.id] && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {balances[token.id]}
                            </span>
                          )}
                        </button>
                      </li>
                    </>
                  );
                })}
              </ul>
            )}
          </div>

          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-lg p-1 text-zinc-400 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-zinc-200"
              aria-label="Close"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
