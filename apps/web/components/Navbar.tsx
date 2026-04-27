import { WalletButton } from "@/components/WalletButton";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
      <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
        Swyft
      </span>
      <WalletButton />
    </nav>
  );
}
