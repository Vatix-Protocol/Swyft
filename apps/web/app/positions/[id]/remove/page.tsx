"use client";

import { use } from "react";
import Link from "next/link";
import { usePosition } from "@/hooks/usePositions";
import { RemoveLiquidityPanel } from "@/components/RemoveLiquidityPanel";

// Auth token sourced from localStorage (set by the auth flow).
// Replace with a proper auth context once the auth module is wired.
function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("swyft_auth_token");
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RemoveLiquidityPage({ params }: PageProps) {
  const { id } = use(params);
  const authToken = getAuthToken();
  const { position, loading, error } = usePosition(id, authToken);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-label="Loading position" />
      </div>
    );
  }

  if (error || !position) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error ?? "Position not found."}</p>
        <Link href="/portfolio" className="text-sm text-indigo-600 underline hover:text-indigo-500">
          Back to portfolio
        </Link>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
        <p className="text-sm text-zinc-500">Connect your wallet to manage positions.</p>
        <Link href="/" className="text-sm text-indigo-600 underline hover:text-indigo-500">
          Go home
        </Link>
      </div>
    );
  }

  // Derive human-readable symbols from token IDs (truncated until token registry is wired)
  const token0Symbol = position.token0.length > 8 ? `${position.token0.slice(0, 4)}…` : position.token0;
  const token1Symbol = position.token1.length > 8 ? `${position.token1.slice(0, 4)}…` : position.token1;

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 w-full max-w-lg">
        <Link
          href="/portfolio"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Portfolio
        </Link>
      </div>

      <RemoveLiquidityPanel
        position={position}
        token0Symbol={token0Symbol}
        token1Symbol={token1Symbol}
        authToken={authToken}
      />
    </main>
  );
}
