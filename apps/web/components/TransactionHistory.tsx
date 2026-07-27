'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSwaps, SwapSnapshot } from '@/hooks/useSwaps';
import { useLpActivity, LpActivity, LpActivityType } from '@/hooks/useLpActivity';
import { useNetworkContext } from '@/context/NetworkContext';

type Tab = 'swaps' | 'lp';

/** Page size sent to the API and used to derive the total page count. */
const PAGE_SIZE = 20;

/**
 * Props accepted by the transaction history table.
 *
 * @property walletAddress - Wallet address used to load swap and LP history items.
 */
interface TransactionHistoryProps {
  walletAddress: string;
}

/**
 * Transaction history section for swaps and liquidity activity.
 *
 * @param props.walletAddress - Current wallet address used to request history data.
 * @returns A history panel with tabs, date filters, and paginated transaction tables.
 */
export function TransactionHistory({ walletAddress }: TransactionHistoryProps) {
  const { network } = useNetworkContext();
  const [activeTab, setActiveTab] = useState<Tab>('swaps');
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const {
    data: swapsData,
    isLoading: swapsLoading,
    error: swapsError,
  } = useSwaps(walletAddress, page, PAGE_SIZE);
  const {
    data: lpData,
    isLoading: lpLoading,
    error: lpError,
  } = useLpActivity(walletAddress, null, page, PAGE_SIZE);

  const filteredSwaps = filterByDate(swapsData?.items || [], startDate, endDate);
  const filteredLpActivity = filterByDate(lpData?.items || [], startDate, endDate);

  const activeTotal = activeTab === 'swaps' ? (swapsData?.total ?? 0) : (lpData?.total ?? 0);
  const totalPages = Math.ceil(activeTotal / PAGE_SIZE);
  const activeLoading = activeTab === 'swaps' ? swapsLoading : lpLoading;

  // If the underlying data set shrinks (e.g. items removed, or a stale page
  // number left over from a previous tab/filter), snap back to the last page
  // that actually has data instead of showing a page that will always be empty.
  useEffect(() => {
    if (!activeLoading && totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [activeLoading, totalPages, page]);

  function filterByDate<T extends { timestamp: number }>(
    items: T[],
    start: string,
    end: string
  ): T[] {
    if (!start && !end) return items;

    const startTime = start ? new Date(start).getTime() / 1000 : 0;
    const endTime = end ? new Date(end).getTime() / 1000 : Infinity;

    return items.filter((item) => item.timestamp >= startTime && item.timestamp <= endTime);
  }

  function getExplorerUrl(txHash: string): string {
    return `https://stellar.expert/explorer/${network.toLowerCase()}/tx/${txHash}`;
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function truncateHash(hash: string): string {
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm">
      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => {
            setActiveTab('swaps');
            setPage(1);
          }}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'swaps'
              ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          Swaps
        </button>
        <button
          onClick={() => {
            setActiveTab('lp');
            setPage(1);
          }}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'lp'
              ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
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
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'swaps' ? (
          <SwapTable
            swaps={filteredSwaps}
            loading={swapsLoading}
            error={swapsError}
            getExplorerUrl={getExplorerUrl}
            formatDate={formatDate}
            truncateHash={truncateHash}
            cols={7}
            page={page}
            onBackToFirstPage={() => setPage(1)}
          />
        ) : (
          <LpTable
            activities={filteredLpActivity}
            loading={lpLoading}
            error={lpError}
            getExplorerUrl={getExplorerUrl}
            formatDate={formatDate}
            truncateHash={truncateHash}
            page={page}
            onBackToFirstPage={() => setPage(1)}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || swapsLoading || lpLoading}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || swapsLoading || lpLoading}
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
  cols?: number;
  page: number;
  onBackToFirstPage: () => void;
}

function EmptyPageNotice({ onBackToFirstPage }: { onBackToFirstPage: () => void }) {
  return (
    <div className="text-center py-12">
      <p className="text-zinc-500 dark:text-zinc-400 mb-2">No results on this page</p>
      <p className="text-sm text-zinc-400 dark:text-zinc-500">
        <button
          onClick={onBackToFirstPage}
          className="underline hover:text-indigo-500 transition-colors"
        >
          Back to page 1
        </button>
      </p>
    </div>
  );
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="py-3 px-4">
              <div className={`h-4 rounded ${j === 1 ? 'w-32' : 'w-full'} bg-zinc-200 dark:bg-zinc-700 animate-pulse`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SwapTable({
  swaps,
  loading,
  error,
  getExplorerUrl,
  formatDate,
  truncateHash,
  cols = 7,
  page,
  onBackToFirstPage,
}: SwapTableProps) {
  if (error) {
    return <div className="text-center py-8 text-red-500">Failed to load swaps</div>;
  }

  if (!loading && swaps.length === 0) {
    if (page > 1) {
      return <EmptyPageNotice onBackToFirstPage={onBackToFirstPage} />;
    }

    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 dark:text-zinc-400 mb-2">No swap history yet</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Your swaps will appear here once they are indexed.{' '}
          <span className="text-zinc-500 dark:text-zinc-400">
            Head to the{' '}
            <Link href="/" className="underline hover:text-indigo-500 transition-colors">
              Swap page
            </Link>{' '}
            to make your first trade.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Pair
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Route
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Input
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Output
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Price
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Transaction
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows cols={cols} />
          ) : (
            swaps.map((swap) => (
              <tr
                key={swap.id}
                className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <td className="py-3 px-4 text-sm text-zinc-900 dark:text-zinc-100">
                  {swap.token0Symbol}/{swap.token1Symbol}
                </td>
                <td className="py-3 px-4 text-sm text-zinc-700 dark:text-zinc-300">
                  {swap.routeLeg && swap.routeLeg.length > 0 ? (
                    <span className="font-mono text-xs">
                      {swap.routeLeg.join(' → ')}
                    </span>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">—</span>
                  )}
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
            ))
          )}
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
  page: number;
  onBackToFirstPage: () => void;
}

function LpTable({
  activities,
  loading,
  error,
  getExplorerUrl,
  formatDate,
  truncateHash,
  page,
  onBackToFirstPage,
}: LpTableProps) {
  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-2">Authentication required</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view LP activity
        </p>
      </div>
    );
  }

  if (!loading && activities.length === 0) {
    if (page > 1) {
      return <EmptyPageNotice onBackToFirstPage={onBackToFirstPage} />;
    }

    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 dark:text-zinc-400 mb-2">No LP activity yet</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Your liquidity events will appear here once they are indexed.{' '}
          <span className="text-zinc-500 dark:text-zinc-400">
            Visit the{' '}
            <Link href="/pools" className="underline hover:text-indigo-500 transition-colors">
              Pools page
            </Link>{' '}
            to add liquidity and start earning fees.
          </span>
        </p>
      </div>
    );
  }

  const getTypeColor = (type: LpActivityType): string => {
    switch (type) {
      case 'mint':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'burn':
        return 'text-red-600 dark:text-red-400';
      case 'fee_collection':
        return 'text-amber-600 dark:text-amber-400';
    }
  };

  const getTypeLabel = (type: LpActivityType): string => {
    switch (type) {
      case 'mint':
        return 'Add';
      case 'burn':
        return 'Remove';
      case 'fee_collection':
        return 'Fees';
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Type
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Pair
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Amount 0
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Amount 1
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Transaction
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows cols={6} />
          ) : (
            activities.map((activity) => (
              <tr
                key={activity.id}
                className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <td className="py-3 px-4 text-sm font-medium capitalize">
                  <span className={getTypeColor(activity.type)}>{getTypeLabel(activity.type)}</span>
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
