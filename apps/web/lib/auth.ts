'use client';

import { signMessage } from '@stellar/freighter-api';
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
 * Runs the full wallet-based auth handshake against the API:
 *   1. POST /auth/nonce  — obtain a short-lived nonce for `walletAddress`.
 *   2. Sign the nonce with Freighter (`signMessage`).
 *   3. POST /auth/verify — exchange the signature for a JWT.
 *
 * On success the JWT is persisted to localStorage under
 * `swyft_auth_token` and returned to the caller. Throws on any failure
 * (nonce issuance, wallet rejection, or verification) — callers are
 * responsible for surfacing the error to the user. Never logs the
 * signature, nonce, or resulting token.
 */
export async function authenticateWallet(walletAddress: string): Promise<string> {
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

  const signResult = await signMessage(nonceData.nonce, { address: walletAddress });
  const signature =
    typeof signResult === 'string'
      ? signResult
      : 'signedMessage' in signResult
        ? (signResult as { signedMessage: string }).signedMessage
        : null;

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
