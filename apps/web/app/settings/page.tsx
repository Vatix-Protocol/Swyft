'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletContext } from '@/context/WalletContext';
import { WebhooksPanel } from '@/components/WebhooksPanel';
import { WalletButton } from '@/components/WalletButton';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('swyft_auth_token');
}

export default function SettingsPage() {
  const router = useRouter();
  const { address } = useWalletContext();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    setAuthToken(getAuthToken());
  }, [address]);

  useEffect(() => {
    if (!address) {
      router.replace('/');
    }
  }, [address, router]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Developer Settings
        </h1>
        {!address && <WalletButton />}
      </div>

      {address ? (
        <WebhooksPanel authToken={authToken} />
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Connect your wallet to manage webhooks.
        </p>
      )}
    </main>
  );
}
