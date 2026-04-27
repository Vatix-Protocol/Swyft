"use client";

import { useState, useRef, useEffect } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { SWYFT_NETWORK } from "@/lib/constants";

function truncate(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const { address, error, connecting, connect, disconnect } = useWalletContext();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (address) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
          title={address}
        >
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {truncate(address)}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-50">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Connected wallet</p>
              <p className="mt-1 break-all text-xs font-mono text-zinc-800 dark:text-zinc-200">
                {address}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Network: <span className="font-medium">{SWYFT_NETWORK}</span>
              </p>
            </div>
            <div className="p-2 flex flex-col gap-1">
              <button
                onClick={copyAddress}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                {copied ? "Copied!" : "Copy address"}
              </button>
              <button
                onClick={() => { disconnect(); setOpen(false); }}
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={connect}
        disabled={connecting}
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>

      {error === "NOT_INSTALLED" && (
        <p className="text-xs text-red-500">
          Freighter not found.{" "}
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Install it here
          </a>
        </p>
      )}
      {error === "REJECTED" && (
        <p className="text-xs text-red-500">Connection rejected.</p>
      )}
      {error === "WRONG_NETWORK" && (
        <p className="text-xs text-red-500">
          Switch Freighter to <strong>{SWYFT_NETWORK}</strong> and try again.
        </p>
      )}
    </div>
  );
}
