const API_KEY_ENV = 'NEXT_PUBLIC_SWYFT_API_KEY';

let warnedAboutMissingApiKey = false;

/**
 * Wraps `fetch` for the read-only market-data endpoints that sit behind
 * `ApiKeyGuard` on the API.
 *
 * When `NEXT_PUBLIC_SWYFT_API_KEY` is set, the `X-Api-Key` header is attached
 * to every request. When it is not set, a single warning is emitted so the
 * misconfiguration is visible instead of silently producing unauthenticated
 * requests. Caller-supplied `init.headers` are always preserved.
 */
export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = process.env[API_KEY_ENV];

  if (!apiKey) {
    if (!warnedAboutMissingApiKey) {
      warnedAboutMissingApiKey = true;
      console.warn(
        `[apiFetch] ${API_KEY_ENV} is not set; requests to API-key-protected ` +
          'endpoints will be sent without an X-Api-Key header.',
      );
    }

    return fetch(input, init);
  }

  const headers = new Headers(init.headers);
  headers.set('X-Api-Key', apiKey);

  return fetch(input, { ...init, headers });
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
