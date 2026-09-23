import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitTransaction,
  MevSubmissionError,
} from '../lib/mev-submission';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  delete process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL;
});

const SIGNED_XDR = 'AAAAAgAAAAB...';
const API_BASE = 'http://localhost:3001/v1';
const MEV_RPC = 'https://mev-rpc.example.com';

describe('submitTransaction', () => {
  describe('standard API submission (MEV disabled)', () => {
    it('submits through the API backend when MEV is disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hash: 'abc123' }),
      });

      const result = await submitTransaction({
        signedXdr: SIGNED_XDR,
        apiBase: API_BASE,
        mevEnabled: false,
        mevRpcUrl: undefined,
      });

      expect(result).toEqual({ hash: 'abc123', submittedVia: 'api' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/transactions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ xdr: SIGNED_XDR }),
        }),
      );
    });

    it('throws MevSubmissionError on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'bad request', code: 'TX_FAILED' }),
      });

      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: false,
          mevRpcUrl: undefined,
        }),
      ).rejects.toThrow(MevSubmissionError);
    });
  });

  describe('MEV-protected RPC submission', () => {
    it('submits directly to the MEV RPC when enabled and configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: { hash: 'mev-hash-456', status: 'PENDING' },
          }),
      });

      const result = await submitTransaction({
        signedXdr: SIGNED_XDR,
        apiBase: API_BASE,
        mevEnabled: true,
        mevRpcUrl: MEV_RPC,
      });

      expect(result).toEqual({ hash: 'mev-hash-456', submittedVia: 'mev-rpc' });
      expect(mockFetch).toHaveBeenCalledWith(
        MEV_RPC,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('sendTransaction'),
        }),
      );
    });

    it('passes the signed XDR in the sendTransaction params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: { hash: 'h', status: 'PENDING' },
          }),
      });

      await submitTransaction({
        signedXdr: SIGNED_XDR,
        apiBase: API_BASE,
        mevEnabled: true,
        mevRpcUrl: MEV_RPC,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('sendTransaction');
      expect(body.params.transaction).toBe(SIGNED_XDR);
    });

    it('throws MevSubmissionError on MEV RPC HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
      });

      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: true,
          mevRpcUrl: MEV_RPC,
        }),
      ).rejects.toThrow(MevSubmissionError);
    });

    it('throws MevSubmissionError when RPC returns an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32600, message: 'Invalid Request' },
          }),
      });

      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: true,
          mevRpcUrl: MEV_RPC,
        }),
      ).rejects.toThrow('Invalid Request');
    });

    it('throws when transaction status is ERROR', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: '2.0',
            id: 1,
            result: { status: 'ERROR', errorResultXdr: 'AAAA...' },
          }),
      });

      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: true,
          mevRpcUrl: MEV_RPC,
        }),
      ).rejects.toThrow('Transaction rejected');
    });
  });

  describe('MEV enabled but not configured', () => {
    it('throws MevSubmissionError when MEV is enabled but URL is undefined', async () => {
      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: true,
          mevRpcUrl: undefined,
        }),
      ).rejects.toThrow('MEV protection is enabled but');
    });

    it('throws MevSubmissionError when MEV is enabled but URL is invalid', async () => {
      await expect(
        submitTransaction({
          signedXdr: SIGNED_XDR,
          apiBase: API_BASE,
          mevEnabled: true,
          mevRpcUrl: 'not-a-url',
        }),
      ).rejects.toThrow('MEV protection is enabled but');
    });

    it('does NOT silently fall back to the API', async () => {
      // This is critical: users who enable MEV protection expect privacy.
      // Silently falling back to the public API would break that guarantee.
      const promise = submitTransaction({
        signedXdr: SIGNED_XDR,
        apiBase: API_BASE,
        mevEnabled: true,
        mevRpcUrl: undefined,
      });

      await expect(promise).rejects.toThrow(MevSubmissionError);
      // fetch should NOT have been called at all
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
