import Link from "next/link";
import { AddLiquidity } from "@/components/AddLiquidity";

export const metadata = {
  title: "Add Liquidity — Swyft",
  description: "Provide concentrated liquidity on Swyft",
};

export default function AddLiquidityPage() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-start px-4 py-10">
      <div className="mb-6 w-full max-w-lg">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Home
        </Link>
      </div>
      <AddLiquidity />
    </main>
  );
}
