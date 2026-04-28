import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
          Swyft
        </Link>
        <Link href="/portfolio" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
          Portfolio
        </Link>
      </div>
      <WalletButton />
    </nav>
  );
}
