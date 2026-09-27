'use client';

import { signMessage as freighterSignMessage } from '@stellar/freighter-api';
import { API_BASE } from '@/lib/constants';

/** localStorage key used to persist the short-lived wallet-auth JWT. */
export const AUTH_TOKEN_STORAGE_KEY = 'swyft_auth_token';

/** Reads the persisted JWT, or null when unset / running on the server. */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

/**
 * Resolves a wallet-kind-aware `signMessage` function.
 *
 * For Freighter we call its native `signMessage`.
 * For xBull we attempt to use the wallets-kit's `signMessage` if available,
 * falling back to Freighter as a last resort so the auth flow always has a
 * signer to call.
 *
 * The returned function accepts a `(message, address)` pair and returns the
 * signed message string.
 */
async function resolveMessageSigner(
  walletKind: 'freighter' | 'xbull',
  walletAddress: string
): Promise<(message: string) => Promise<string>> {
  if (walletKind === 'xbull') {
    try {
      const kit = await import('@creit.tech/stellar-wallets-kit');
      if (typeof kit.StellarWalletsKit === 'function') {
        const instance = new (kit.StellarWalletsKit as new (opts: unknown) => unknown)({
          network: 'TESTNET',
          selectedWalletId: kit.XBULL_ID ?? 'xbull',
          modules: kit.allowAllModules ? kit.allowAllModules() : [],
        }) as { signMessage?: (msg: string, opts?: Record<string, unknown>) => Promise<{ signedMessage: string }> };

        if (typeof instance.signMessage === 'function') {
          return async (message: string) => {
            const result = await instance.signMessage!(message, { address: walletAddress });
            return result.signedMessage;
          };
        }
      }
    } catch {
      // Kit unavailable — fall through to Freighter
    }
  }

  // Default: Freighter signMessage
  return async (message: string) => {
    const signResult = await freighterSignMessage(message, { address: walletAddress });
    if (typeof signResult === 'string') return signResult;
    if (signResult && typeof signResult === 'object' && 'signedMessage' in signResult) {
      return (signResult as { signedMessage: string }).signedMessage;
    }
    throw new Error('Wallet signature was rejected.');
  };
}

/**
 * Runs the full wallet-based auth handshake against the API:
 *   1. POST /auth/nonce  — obtain a short-lived nonce for `walletAddress`.
 *   2. Sign the nonce with the active wallet.
 *   3. POST /auth/verify — exchange the signature for a JWT.
 *
 * On success the JWT is persisted to localStorage under
 * `swyft_auth_token` and returned to the caller. Throws on any failure
 * (nonce issuance, wallet rejection, or verification) — callers are
 * responsible for surfacing the error to the user. Never logs the
 * signature, nonce, or resulting token.
 *
 * @param walletAddress - Connected wallet address.
 * @param walletKind    - Which wallet is active ('freighter' | 'xbull').
 *                        Defaults to 'freighter' for backward compatibility.
 */
export async function authenticateWallet(
  walletAddress: string,
  walletKind: 'freighter' | 'xbull' = 'freighter'
): Promise<string> {
  const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });

  if (!nonceRes.ok) {
    throw new Error('Failed to request an authentication nonce.');
  }

  const nonceData = (await nonceRes.json()) as { nonce: string | null };
  if (!nonceData.nonce) {
    throw new Error('Failed to request an authentication nonce.');
  }

  const signer = await resolveMessageSigner(walletKind, walletAddress);
  const signature = await signer(nonceData.nonce);

  if (!signature) {
    throw new Error('Wallet signature was rejected.');
  }

  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, nonce: nonceData.nonce, signature }),
  });

  if (!verifyRes.ok) {
    throw new Error('Wallet signature verification failed.');
  }

  const verifyData = (await verifyRes.json()) as { accessToken: string };
  if (!verifyData.accessToken) {
    throw new Error('Wallet signature verification failed.');
  }

  setAuthToken(verifyData.accessToken);
  return verifyData.accessToken;
}
