import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Token } from '@swyft/ui';
import type { SwapQuote } from '@swyft/sdk';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSignTransaction = vi.fn();
vi.mock('@stellar/freighter-api', () => ({
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

const mockBuildSwapTx = vi.fn();
const mockBuildExactOutputSwapTx = vi.fn();
vi.mock('@swyft/sdk', async () => {
  const actual = await vi.importActual<typeof import('@swyft/sdk')>('@swyft/sdk');
  return {
    ...actual,
    buildSwapTx: (...args: unknown[]) => mockBuildSwapTx(...args),
    buildExactOutputSwapTx: (...args: unknown[]) => mockBuildExactOutputSwapTx(...args),
  };
});

const mockReportTx = vi.fn();
vi.mock('@/context/TransactionStatusContext', () => ({
  useTransactionStatus: () => ({ reportTx: mockReportTx }),
}));

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ network: 'TESTNET' }),
}));

vi.mock('@/lib/constants', () => ({
  API_BASE: 'http://localhost:3001/v1',
  ROUTER_ADDRESS: 'CROUTERADDRESSCROUTERADDRESSCROUTERADDRESSCROUTERAD',
  getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
}));

// Controllable MEV-protection state for each test. Defaults to disabled so
// existing tests (written before MEV routing existed) keep exercising the
// plain POST /transactions path without changes.
const mevState: { enabled: boolean; mevRpcUrl: string | undefined } = {
  enabled: false,
  mevRpcUrl: undefined,
};
vi.mock('./useMevProtection', () => ({
  useMevProtection: () => ({
    enabled: mevState.enabled,
    available: mevState.mevRpcUrl !== undefined,
    toggle: vi.fn(),
    rpcUrl: mevState.mevRpcUrl ?? 'https://soroban-testnet.stellar.org',
    mevRpcUrl: mevState.mevRpcUrl,
  }),
}));

import { useSwapExecution } from './useSwapExecution';

const MEV_RPC_URL = 'https://mev-rpc.example.com';

/** Mocks a single successful Soroban `sendTransaction` JSON-RPC response. */
function mockRpcSendTransactionOnce(hash: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { status: 'PENDING', hash },
    }),
  }) as unknown as typeof fetch;
}

const tokenIn: Token = { id: 'CTOKENIN', symbol: 'USDC', name: 'USD Coin', logoUrl: null };
const tokenOut: Token = { id: 'CTOKENOUT', symbol: 'XLM', name: 'Stellar Lumens', logoUrl: null };

const quote: SwapQuote = {
  amountOut: '95',
  priceImpact: 0.5,
  lpFee: '0.3',
  protocolFee: '0',
  minimumReceived: '94.5',
  executionPrice: '0.95',
};

function mockFetchOnce(response: Partial<Response> & { json: () => Promise<unknown> }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: response.json,
    ...response,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildSwapTx.mockReturnValue({ xdr: 'unsigned-xdr', type: 'swap' });
  mockBuildExactOutputSwapTx.mockReturnValue({ xdr: 'unsigned-exact-out-xdr', type: 'swap' });
  mevState.enabled = false;
  mevState.mevRpcUrl = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSwapExecution — exact-input signing and submission', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useSwapExecution());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeNull();
  });

  it('signs and submits successfully, ending in a success state with the tx hash', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'abc123' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(mockBuildSwapTx).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: 'CPOOL',
        tokenInId: 'CTOKENIN',
        tokenOutId: 'CTOKENOUT',
        amountIn: '100',
        minimumReceived: '94.5',
        ownerAddress: 'GWALLET',
      })
    );
    expect(mockSignTransaction).toHaveBeenCalledWith(
      'unsigned-xdr',
      expect.objectContaining({ networkPassphrase: expect.any(String) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ xdr: 'signed-xdr' }),
      })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('abc123');
    expect(result.current.error).toBeNull();
  });

  it('handles a signResult object shape ({ signedTxXdr })', async () => {
    mockSignTransaction.mockResolvedValue({ signedTxXdr: 'signed-from-object' });
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'hash2' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.objectContaining({ body: JSON.stringify({ xdr: 'signed-from-object' }) })
    );
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('hash2');
  });

  it('silently returns to idle when the wallet rejects the signature (no signedTxXdr)', async () => {
    mockSignTransaction.mockResolvedValue({ notSigned: true });

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sets status to idle when signing throws a rejection-style error', async () => {
    mockSignTransaction.mockRejectedValue(new Error('User rejected access'));

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a network error when signing throws a non-rejection error', async () => {
    mockSignTransaction.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('network');
    expect(result.current.detail).toBe('boom');
  });

  it('maps a SLIPPAGE_EXCEEDED response to the slippage error', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({
      ok: false,
      json: async () => ({ code: 'SLIPPAGE_EXCEEDED', message: 'price moved' }),
    } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('slippage');
    expect(result.current.detail).toBe('price moved');
  });

  it('maps a generic non-ok response to a network error and includes result_codes in the detail', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({
      ok: false,
      json: async () => ({
        message: 'tx failed',
        extras: { result_codes: { transaction: 'tx_bad_seq' } },
      }),
    } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('network');
    expect(result.current.detail).toContain('tx failed');
    expect(result.current.detail).toContain('tx_bad_seq');
  });

  it('reset() returns to idle with cleared fields', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'abc123' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeNull();
    expect(result.current.detail).toBeNull();
  });

  it('mirrors status transitions into the app-wide transaction indicator via reportTx', async () => {
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'abc123' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(mockReportTx).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', txHash: 'abc123' })
    );
  });
});

describe('useSwapExecution — exact-output signing and submission', () => {
  it('builds and submits an exact-output swap via the router', async () => {
    mockSignTransaction.mockResolvedValue('signed-exact-out-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'exact-out-hash' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.executeExactOutput({
        fee: 30,
        tokenIn,
        tokenOut,
        amountOut: '50',
        quote: {
          amountIn: '52.6',
          maximumIn: '52.86',
          priceImpact: 0.4,
          lpFee: '0.16',
          protocolFee: '0',
          executionPrice: '0.95',
        },
        walletAddress: 'GWALLET',
      });
    });

    expect(mockBuildExactOutputSwapTx).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenInId: 'CTOKENIN',
        tokenOutId: 'CTOKENOUT',
        fee: 30,
        amountOut: '50',
        amountInMax: '52.86',
        ownerAddress: 'GWALLET',
      })
    );
    expect(mockSignTransaction).toHaveBeenCalledWith(
      'unsigned-exact-out-xdr',
      expect.objectContaining({ networkPassphrase: expect.any(String) })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('exact-out-hash');
  });
});

describe('useSwapExecution — MEV-protected routing (exact-input)', () => {
  it('submits directly to the MEV RPC URL (not POST /transactions) when MEV protection is enabled', async () => {
    mevState.enabled = true;
    mevState.mevRpcUrl = MEV_RPC_URL;
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockRpcSendTransactionOnce('mev-hash-1');

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      MEV_RPC_URL,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('sendTransaction'),
      })
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.anything()
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('mev-hash-1');
  });

  it('still uses POST /transactions when MEV protection is disabled', async () => {
    mevState.enabled = false;
    mevState.mevRpcUrl = MEV_RPC_URL; // configured but not enabled
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'api-hash-1' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.objectContaining({ method: 'POST' })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('api-hash-1');
  });

  it('surfaces a clear error and does NOT fall back to POST /transactions when MEV is enabled but no valid RPC URL is configured', async () => {
    mevState.enabled = true;
    mevState.mevRpcUrl = undefined;
    mockSignTransaction.mockResolvedValue('signed-xdr');
    global.fetch = vi.fn();

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.execute({
        poolId: 'CPOOL',
        tokenIn,
        tokenOut,
        amountIn: '100',
        quote,
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.detail).toContain('MEV protection is enabled');
    // Critical: no silent fallback to the unprotected endpoint.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('useSwapExecution — MEV-protected routing (exact-output)', () => {
  it('submits directly to the MEV RPC URL (not POST /transactions) when MEV protection is enabled', async () => {
    mevState.enabled = true;
    mevState.mevRpcUrl = MEV_RPC_URL;
    mockSignTransaction.mockResolvedValue('signed-exact-out-xdr');
    mockRpcSendTransactionOnce('mev-hash-2');

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.executeExactOutput({
        fee: 30,
        tokenIn,
        tokenOut,
        amountOut: '50',
        quote: {
          amountIn: '52.6',
          maximumIn: '52.86',
          priceImpact: 0.4,
          lpFee: '0.16',
          protocolFee: '0',
          executionPrice: '0.95',
        },
        walletAddress: 'GWALLET',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      MEV_RPC_URL,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('sendTransaction'),
      })
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.anything()
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('mev-hash-2');
  });

  it('still uses POST /transactions when MEV protection is disabled', async () => {
    mevState.enabled = false;
    mevState.mevRpcUrl = undefined;
    mockSignTransaction.mockResolvedValue('signed-exact-out-xdr');
    mockFetchOnce({ ok: true, json: async () => ({ hash: 'exact-out-api-hash' }) } as any);

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.executeExactOutput({
        fee: 30,
        tokenIn,
        tokenOut,
        amountOut: '50',
        quote: {
          amountIn: '52.6',
          maximumIn: '52.86',
          priceImpact: 0.4,
          lpFee: '0.16',
          protocolFee: '0',
          executionPrice: '0.95',
        },
        walletAddress: 'GWALLET',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.objectContaining({ method: 'POST' })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.txHash).toBe('exact-out-api-hash');
  });

  it('surfaces a clear error and does NOT fall back to POST /transactions when MEV is enabled but no valid RPC URL is configured', async () => {
    mevState.enabled = true;
    mevState.mevRpcUrl = undefined;
    mockSignTransaction.mockResolvedValue('signed-exact-out-xdr');
    global.fetch = vi.fn();

    const { result } = renderHook(() => useSwapExecution());

    await act(async () => {
      await result.current.executeExactOutput({
        fee: 30,
        tokenIn,
        tokenOut,
        amountOut: '50',
        quote: {
          amountIn: '52.6',
          maximumIn: '52.86',
          priceImpact: 0.4,
          lpFee: '0.16',
          protocolFee: '0',
          executionPrice: '0.95',
        },
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.detail).toContain('MEV protection is enabled');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('useSwapExecution — exact-output without a configured router', () => {
  it('errors without attempting to build or sign a transaction', async () => {
    vi.resetModules();
    vi.doMock('@/lib/constants', () => ({
      API_BASE: 'http://localhost:3001/v1',
      ROUTER_ADDRESS: '',
      getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
    }));
    const { useSwapExecution: useSwapExecutionNoRouter } = await import('./useSwapExecution');

    const { result } = renderHook(() => useSwapExecutionNoRouter());

    await act(async () => {
      await result.current.executeExactOutput({
        fee: 30,
        tokenIn,
        tokenOut,
        amountOut: '50',
        quote: {
          amountIn: '52.6',
          maximumIn: '52.86',
          priceImpact: 0.4,
          lpFee: '0.16',
          protocolFee: '0',
          executionPrice: '0.95',
        },
        walletAddress: 'GWALLET',
      });
    });

    expect(result.current.status).toBe('error');
    expect(mockBuildExactOutputSwapTx).not.toHaveBeenCalled();
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });
});
