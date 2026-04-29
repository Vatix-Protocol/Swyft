"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";

const NAV_LINKS = [
  { href: "/", label: "Swap" },
  { href: "/portfolio", label: "Portfolio" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white hover:opacity-80 transition-opacity">
          Swyft
        </Link>
        <Link href="/history" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors">
          History
        </Link>
      </div>
      <WalletButton />
    </nav>
  );
}
