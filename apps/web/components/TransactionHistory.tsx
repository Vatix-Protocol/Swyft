"use client";

import { useState } from "react";
import { useSwaps, SwapSnapshot } from "@/hooks/useSwaps";
import { useLpActivity, LpActivity } from "@/hooks/useLpActivity";
import { SWYFT_NETWORK } from "@/lib/constants";

type Tab = "swaps" | "lp";

interface TransactionHistoryProps {
  walletAddress: string;
}

export function TransactionHistory({ walletAddress }: TransactionHistoryProps) {
  const [activeTab, setActiveTab] = useState<Tab>("swaps");
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const { data: swapsData, isLoading: swapsLoading, error: swapsError } = useSwaps(walletAddress, page);
  const { data: lpData, isLoading: lpLoading, error: lpError } = useLpActivity(walletAddress, null, page);

  const filteredSwaps = filterByDate(swapsData?.items || [], startDate, endDate);
  const filteredLpActivity = filterByDate(lpData?.items || [], startDate, endDate);

  const totalPages = Math.ceil(
    (activeTab === "swaps" ? swapsData?.total : lpData?.total || 0) / 20
  );

  function filterByDate<T extends { timestamp: number }>(items: T[], start: string, end: string): T[] {
    if (!start && !end) return items;
    
    const startTime = start ? new Date(start).getTime() / 1000 : 0;
    const endTime = end ? new Date(end).getTime() / 1000 : Infinity;
    
    return items.filter((item) => item.timestamp >= startTime && item.timestamp <= endTime);
  }

  function getExplorerUrl(txHash: string) {
    const network = SWYFT_NETWORK.toLowerCase();
    return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  }

  function formatDate(timestamp: number) {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function truncateHash(hash: string) {
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm">
      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => { setActiveTab("swaps"); setPage(1); }}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "swaps"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Swaps
        </button>
        <button
          onClick={() => { setActiveTab("lp"); setPage(1); }}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "lp"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          LP Activity
        </button>
      </div>

      {/* Date Filter */}
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">From:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">To:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
        {(startDate || endDate) && (
          <button
            onClick={() => { setStartDate(""); setEndDate(""); }}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === "swaps" ? (
          <SwapTable
            swaps={filteredSwaps}
            loading={swapsLoading}
            error={swapsError}
            getExplorerUrl={getExplorerUrl}
            formatDate={formatDate}
            truncateHash={truncateHash}
          />
        ) : (
          <LpTable
            activities={filteredLpActivity}
            loading={lpLoading}
            error={lpError}
            getExplorerUrl={getExplorerUrl}
            formatDate={formatDate}
            truncateHash={truncateHash}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SwapTableProps {
  swaps: SwapSnapshot[];
  loading: boolean;
  error: unknown;
  getExplorerUrl: (hash: string) => string;
  formatDate: (timestamp: number) => string;
  truncateHash: (hash: string) => string;
}

function SwapTable({ swaps, loading, error, getExplorerUrl, formatDate, truncateHash }: SwapTableProps) {
  if (loading) {
    return <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">Loading swaps...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">Failed to load swaps</div>;
  }

  if (swaps.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 dark:text-zinc-400 mb-2">No swap history found</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Your swap transactions will appear here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Pair</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Input</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Output</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Price</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Transaction</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Time</th>
          </tr>
        </thead>
        <tbody>
          {swaps.map((swap) => (
            <tr key={swap.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <td className="py-3 px-4 text-sm text-zinc-900 dark:text-zinc-100">
                {swap.token0Symbol}/{swap.token1Symbol}
              </td>
              <td className="py-3 px-4 text-sm text-right text-zinc-900 dark:text-zinc-100 font-mono">
                {swap.amount0}
              </td>
              <td className="py-3 px-4 text-sm text-right text-zinc-900 dark:text-zinc-100 font-mono">
                {swap.amount1}
              </td>
              <td className="py-3 px-4 text-sm text-right text-zinc-900 dark:text-zinc-100 font-mono">
                {swap.priceAtSwap}
              </td>
              <td className="py-3 px-4 text-sm">
                <a
                  href={getExplorerUrl(swap.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-mono"
                >
                  {truncateHash(swap.txHash)}
                </a>
              </td>
              <td className="py-3 px-4 text-sm text-zinc-600 dark:text-zinc-400">
                {formatDate(swap.timestamp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LpTableProps {
  activities: LpActivity[];
  loading: boolean;
  error: unknown;
  getExplorerUrl: (hash: string) => string;
  formatDate: (timestamp: number) => string;
  truncateHash: (hash: string) => string;
}

function LpTable({ activities, loading, error, getExplorerUrl, formatDate, truncateHash }: LpTableProps) {
  if (loading) {
    return <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">Loading LP activity...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-2">Authentication required</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Connect your wallet to view LP activity</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 dark:text-zinc-400 mb-2">No LP activity found</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Your liquidity operations will appear here</p>
      </div>
    );
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case "mint":
        return "text-emerald-600 dark:text-emerald-400";
      case "burn":
        return "text-red-600 dark:text-red-400";
      case "fee_collection":
        return "text-amber-600 dark:text-amber-400";
      default:
        return "text-zinc-600 dark:text-zinc-400";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "mint":
        return "Add";
      case "burn":
        return "Remove";
      case "fee_collection":
        return "Fees";
      default:
        return type;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Type</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Pair</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Amount 0</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Amount 1</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Transaction</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Time</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => (
            <tr key={activity.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <td className="py-3 px-4 text-sm font-medium capitalize">
                <span className={getTypeColor(activity.type)}>
                  {getTypeLabel(activity.type)}
                </span>
              </td>
              <td className="py-3 px-4 text-sm text-zinc-900 dark:text-zinc-100">
                {activity.token0Symbol}/{activity.token1Symbol}
              </td>
              <td className="py-3 px-4 text-sm text-right text-zinc-900 dark:text-zinc-100 font-mono">
                {activity.amount0}
              </td>
              <td className="py-3 px-4 text-sm text-right text-zinc-900 dark:text-zinc-100 font-mono">
                {activity.amount1}
              </td>
              <td className="py-3 px-4 text-sm">
                <a
                  href={getExplorerUrl(activity.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-mono"
                >
                  {truncateHash(activity.txHash)}
                </a>
              </td>
              <td className="py-3 px-4 text-sm text-zinc-600 dark:text-zinc-400">
                {formatDate(activity.timestamp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
