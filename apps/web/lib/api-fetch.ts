/**
 * `fetch` wrapper for the read-only market-data endpoints (pools, prices,
 * tokens, swaps, search, balances) that require an `X-Api-Key` header now
 * that they're behind `ApiKeyGuard` on the API. Sends
 * `NEXT_PUBLIC_SWYFT_API_KEY` when set; unauthenticated endpoints
 * (transactions, auth, webhooks) should keep using plain `fetch`.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.NEXT_PUBLIC_SWYFT_API_KEY;
  if (!apiKey) return fetch(input, init);

  return fetch(input, {
    ...init,
    headers: { ...init.headers, 'X-Api-Key': apiKey },
  });
}
