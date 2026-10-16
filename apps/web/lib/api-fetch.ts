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

/**
 * Error thrown by {@link apiFetchJson} for non-2xx responses. Carries the HTTP
 * `status` so callers (and the QueryClient retry policy in
 * `app/providers.tsx`) can distinguish 4xx client errors from transient
 * failures without re-parsing the response.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * `apiFetch` + JSON parsing that throws an {@link ApiError} (with `status`)
 * on non-2xx responses. Use this for read-only market-data endpoints so the
 * shared query retry policy can inspect `error.status`.
 */
export async function apiFetchJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    throw new ApiError(res.status, `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}
