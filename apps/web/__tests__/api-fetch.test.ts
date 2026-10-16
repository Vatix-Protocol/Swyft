import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_API_KEY = process.env.NEXT_PUBLIC_SWYFT_API_KEY;

async function loadApiFetch() {
  vi.resetModules();
  return import('../lib/api-fetch');
}

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.NEXT_PUBLIC_SWYFT_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_SWYFT_API_KEY = ORIGINAL_API_KEY;
    }
  });

  it('attaches X-Api-Key when NEXT_PUBLIC_SWYFT_API_KEY is set', async () => {
    process.env.NEXT_PUBLIC_SWYFT_API_KEY = 'test-api-key';
    const { apiFetch } = await loadApiFetch();

    await apiFetch('/api/markets');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Api-Key')).toBe('test-api-key');
  });

  it('warns once and omits X-Api-Key when the env var is unset', async () => {
    delete process.env.NEXT_PUBLIC_SWYFT_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apiFetch } = await loadApiFetch();

    await apiFetch('/api/markets');
    await apiFetch('/api/markets');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('NEXT_PUBLIC_SWYFT_API_KEY');

    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('X-Api-Key')).toBeNull();
    }
  });

  it('preserves caller-supplied headers when the key is set', async () => {
    process.env.NEXT_PUBLIC_SWYFT_API_KEY = 'test-api-key';
    const { apiFetch } = await loadApiFetch();

    await apiFetch('/api/markets', {
      headers: { 'X-Custom': 'custom-value' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Custom')).toBe('custom-value');
    expect(headers.get('X-Api-Key')).toBe('test-api-key');
  });

  it('preserves caller-supplied headers when the key is unset', async () => {
    delete process.env.NEXT_PUBLIC_SWYFT_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { apiFetch } = await loadApiFetch();

    await apiFetch('/api/markets', {
      headers: { 'X-Custom': 'custom-value' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Custom')).toBe('custom-value');
    expect(headers.get('X-Api-Key')).toBeNull();
  });
});
