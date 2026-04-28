"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { usePortfolio } from "@/hooks/usePortfolio";
import { PositionCard } from "@/components/PositionCard";
import { API_BASE, SWYFT_NETWORK } from "@/lib/constants";
import { signTransaction } from "@stellar/freighter-api";
import { buildCollectTx } from "@swyft/sdk";
import Link from "next/link";

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("swyft_auth_token");
}

export default function PortfolioPage() {
  const router = useRouter();
  const { address } = useWalletContext();
  const authToken = getAuthToken();
  const { active, closed, loading, refresh, totalValueUsd } = usePortfolio(authToken);
  const [showClosed, setShowClosed] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);

  // Redirect if no wallet connected
  useEffect(() => {
    if (address === null && !loading) {
      router.replace("/");
    }
  }, [address, loading, router]);

  const handleCollectFees = useCallback(async (positionId: string) => {
    if (!authToken) return;
    const position = active.find((p) => p.id === positionId);
    if (!position) return;

    setCollectingId(positionId);
    try {
      const { xdr } = buildCollectTx({
        positionId: position.id,
        poolId: position.poolId,
        ownerAddress: position.ownerWallet,
      });

      const signResult = await signTransaction(xdr, { network: SWYFT_NETWORK });
      const signedXdr =
        typeof signResult === "string"
          ? signResult
          : "signedTxXdr" in signResult
          ? (signResult as { signedTxXdr: string }).signedTxXdr
          : null;

      if (!signedXdr) return;

      await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ xdr: signedXdr }),
      });

      await refresh();
    } catch {
      // silent — user rejected or network error
    } finally {
      setCollectingId(null);
    }
  }, [authToken, active, refresh]);

  if (!address) return null;

  const positions = showClosed ? [...active, ...closed] : active;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      {/* Summary */}
      <div className="mb-6 sm:mb-8 rounded-2xl border border-zinc-200 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-zinc-400 mb-1">Total portfolio value</p>
        <p className="text-3xl font-bold text-zinc-900 dark:text-white">
          ${totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-xs text-zinc-400 mt-1">{active.length} active position{active.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-white">
          {showClosed ? "All positions" : "Active positions"}
        </h1>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-zinc-500">Show closed</span>
          <button
            type="button"
            role="switch"
            aria-checked={showClosed}
            onClick={() => setShowClosed((v) => !v)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              showClosed ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                showClosed ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </label>
      </div>

      {/* Loading */}
      {loading && positions.length === 0 && (
        <div className="flex justify-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-label="Loading" />
        </div>
      )}

      {/* Empty state */}
      {!loading && positions.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <p className="text-sm text-zinc-500">No positions yet.</p>
          <Link
            href="/pools"
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Browse pools
          </Link>
        </div>
      )}

      {/* Position grid */}
      {positions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {positions.map((p) => (
            <PositionCard
              key={p.id}
              position={p}
              onCollectFees={handleCollectFees}
              collecting={collectingId === p.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}
