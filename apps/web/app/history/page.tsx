'use client';

import { useWalletContext } from '@/context/WalletContext';
import { TransactionHistory } from '@/components/TransactionHistory';
import { WalletButton } from '@/components/WalletButton';

export default function HistoryPage() {
  const { address } = useWalletContext();

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black min-h-screen p-8">
      <div className="max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-6">
          Transaction History
        </h1>
        {!address ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <p className="text-zinc-500 dark:text-zinc-400">
              Connect your wallet to view transaction history.
            </p>
            <WalletButton />
          </div>
        ) : (
          <TransactionHistory walletAddress={address} />
        )}
      </div>
    </div>
  );
}