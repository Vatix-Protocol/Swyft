/**
 * MEV-protected transaction submission.
 *
 * When MEV protection is enabled, transactions are submitted through the
 * MEV-protected RPC endpoint using Soroban's `sendTransaction` RPC method
 * directly — bypassing the public mempool. This prevents front-running
 * and sandwich attacks by keeping transaction details private until they
 * are finalized on-ledger.
 *
 * When MEV protection is disabled (or the MEV endpoint is unavailable),
 * submission falls back to the standard API backend route.
 */

import { isValidRpcUrl } from '../hooks/useMevProtection';

export interface MevSubmissionParams {
  /** Signed XDR envelope (base64). */
  signedXdr: string;
  /** Standard API base URL for fallback submission. */
  apiBase: string;
  /** Wallet-authentication JWT for the API submission path. */
  authToken: string | null;
  /** Whether MEV protection is currently enabled by the user. */
  mevEnabled: boolean;
  /** Resolved MEV-protected RPC URL (validated). */
  mevRpcUrl: string | undefined;
  /** Called once the RPC accepts the transaction but before ledger confirmation. */
  onPending?: (hash: string) => void;
}

export interface SubmissionResult {
  hash: string;
  /** Indicates which path was used for submission. */
  submittedVia: 'mev-rpc' | 'api';
  confirmation: 'pending' | 'confirmed';
}

export class MevSubmissionError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
    public readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'MevSubmissionError';
  }
}

/**
 * Submits a signed XDR directly to a Soroban RPC endpoint using the
 * `sendTransaction` JSON-RPC method, keeping it out of the public mempool.
 *
 * @throws MevSubmissionError on network or RPC-level failures
 */
async function submitViaMevRpc(
  signedXdr: string,
  rpcUrl: string,
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: signedXdr },
    }),
  });

  if (!res.ok) {
    throw new MevSubmissionError(
      `MEV RPC responded with HTTP ${res.status}`,
      'MEV_RPC_HTTP_ERROR',
    );
  }

  const body = await res.json();

  if (body.error) {
    throw new MevSubmissionError(
      body.error.message ?? 'MEV RPC returned an error',
      body.error.code?.toString() ?? 'MEV_RPC_ERROR',
      JSON.stringify(body.error.data ?? null),
    );
  }

  const result = body.result;
  if (!result) {
    throw new MevSubmissionError(
      'MEV RPC returned no result',
      'MEV_RPC_EMPTY',
    );
  }

  // Soroban sendTransaction returns status and hash
  if (result.status === 'ERROR') {
    throw new MevSubmissionError(
      `Transaction rejected: ${result.errorResultXdr ?? 'unknown'}`,
      'TX_REJECTED',
      result.errorResultXdr ?? null,
    );
  }

  if (!result.hash) {
    throw new MevSubmissionError(
      'MEV RPC did not return a transaction hash',
      'MEV_RPC_NO_HASH',
    );
  }

  return result.hash;
}

const CONFIRMATION_POLL_MS = 2_000;

export async function waitForRpcConfirmation(
  hash: string,
  rpcUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  let retryDelay = CONFIRMATION_POLL_MS;
  for (;;) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: { hash },
        }),
      });
      if (!res.ok) throw new Error(`Soroban RPC responded with HTTP ${res.status}`);

      const body = (await res.json()) as {
        error?: { code?: number; message?: string };
        result?: { status?: string; errorResultXdr?: string };
      };
      if (body.error) throw new Error(body.error.message ?? 'Soroban RPC returned an error');
      if (body.result?.status === 'SUCCESS') return;
      if (body.result?.status === 'FAILED') {
        throw new MevSubmissionError(
          'Transaction failed on-ledger',
          'TX_FAILED',
          body.result.errorResultXdr ?? null,
        );
      }
      if (body.result?.status !== 'NOT_FOUND') {
        throw new MevSubmissionError('Soroban RPC returned an invalid transaction status', 'RPC_ERROR');
      }
    } catch (cause) {
      if (cause instanceof MevSubmissionError) throw cause;
      if (signal?.aborted) throw cause;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, retryDelay);
      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
    retryDelay = Math.min(retryDelay * 2, 10_000);
  }
}

/**
 * Submits a signed XDR through the standard Swyft API backend.
 */
async function submitViaApi(
  signedXdr: string,
  apiBase: string,
  authToken: string | null,
): Promise<{
  hash: string;
  successful: true;
  code?: string;
  message?: string;
  extras?: { result_codes?: unknown };
}> {
  if (!authToken) {
    throw new MevSubmissionError('Wallet authentication is required to submit a transaction', 'UNAUTHORIZED');
  }

  const res = await fetch(`${apiBase}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ xdr: signedXdr }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new MevSubmissionError(
      body.message ?? `API responded with HTTP ${res.status}`,
      body.code ?? 'API_ERROR',
      body.extras?.result_codes ? JSON.stringify(body.extras.result_codes) : null,
    );
  }

  if (typeof body.hash !== 'string' || !body.hash) {
    throw new MevSubmissionError('API returned no transaction hash', 'API_INVALID_RESPONSE');
  }
  if (body.successful !== true) {
    throw new MevSubmissionError(
      body.successful === false
        ? 'Transaction failed on-ledger'
        : 'API did not confirm the transaction result',
      body.successful === false ? 'TX_FAILED' : 'API_INVALID_RESPONSE',
    );
  }

  return body;
}

/**
 * Submits a signed transaction through the appropriate channel:
 *
 * 1. **MEV-protected RPC** (when MEV is enabled and the endpoint is valid):
 *    Posts the signed XDR directly to the Soroban RPC using the
 *    `sendTransaction` JSON-RPC method. This keeps the transaction
 *    private until it is finalized on-ledger.
 *
 * 2. **Standard API** (fallback): Posts to `POST /v1/transactions` on
 *    the Swyft backend, which submits to Horizon.
 *
 * If MEV submission fails, it does NOT silently fall back to the
 * standard API — the error is surfaced so the user knows their
 * transaction was not privately submitted.
 *
 * @throws MevSubmissionError on any submission failure
 */
export async function submitTransaction(
  params: MevSubmissionParams,
): Promise<SubmissionResult> {
  const { signedXdr, apiBase, authToken, mevEnabled, mevRpcUrl, onPending } = params;

  if (mevEnabled && isValidRpcUrl(mevRpcUrl)) {
    // MEV-protected path: submit directly to the private RPC
    const hash = await submitViaMevRpc(signedXdr, mevRpcUrl);
    onPending?.(hash);
    return { hash, submittedVia: 'mev-rpc', confirmation: 'pending' };
  }

  if (mevEnabled && !isValidRpcUrl(mevRpcUrl)) {
    // MEV is enabled but the RPC URL is missing/invalid.
    // Fail explicitly — do not silently fall back.
    throw new MevSubmissionError(
      'MEV protection is enabled but NEXT_PUBLIC_MEV_PROTECTED_RPC_URL is not configured. ' +
        'Disable MEV protection or set a valid endpoint.',
      'MEV_NOT_CONFIGURED',
    );
  }

  // Standard path: submit through the API backend
  const data = await submitViaApi(signedXdr, apiBase, authToken);
  return { hash: data.hash, submittedVia: 'api', confirmation: 'confirmed' };
}
