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
