"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWalletContext } from "@/context/WalletContext";
import { TransactionHistory } from "@/components/TransactionHistory";

export default function HistoryPage() {
  const { address } = useWalletContext();
  const router = useRouter();

  useEffect(() => {
    if (!address) {
      router.push("/");
    }
  }, [address, router]);

  if (!address) {
    return null;
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black min-h-screen p-8">
      <div className="max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-6">
          Transaction History
        </h1>
        <TransactionHistory walletAddress={address} />
      </div>
    </div>
  );
}
