import { ConfigService } from '@nestjs/config';
import { BalancesService } from './balances.service';
import {
  InvalidInputException,
  UpstreamServiceException,
} from '../request-validation/http.exceptions';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  Contract: jest.fn().mockImplementation((address: string) => ({
    call: jest.fn((method: string, ...args: unknown[]) => ({
      __contract: address,
      __method: method,
      __args: args,
    })),
  })),
  nativeToScVal: jest.fn((value: unknown) => ({ __scVal: value })),
  scValToNative: jest.fn((retval: { __raw: unknown }) => retval.__raw),
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
    })),
    Api: {
      isSimulationError: jest.fn(
        (result: { __error?: boolean }) => result?.__error === true,
      ),
    },
  },
}));

// ─── Fixtures — real, well-formed Stellar addresses reused from packages/sdk tests ──

const WALLET = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const TOKEN_A = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3';
const TOKEN_B = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';

describe('BalancesService', () => {
  let prisma: { token: { findMany: jest.Mock } };
  let config: ConfigService;
  let service: BalancesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { token: { findMany: jest.fn() } };
    config = {
      get: jest.fn().mockReturnValue({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        network: 'testnet',
        poolContractId: '',
        poolFactoryContractId: '',
      }),
    } as unknown as ConfigService;
    service = new BalancesService(prisma as never, config);
  });

  it('rejects a malformed wallet address before touching the DB or RPC', async () => {
    await expect(service.getBalances('not-an-address')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
    expect(prisma.token.findMany).not.toHaveBeenCalled();
  });

  it('rejects a missing wallet address', async () => {
    await expect(
      service.getBalances(undefined as unknown as string),
    ).rejects.toBeInstanceOf(InvalidInputException);
  });

  it('returns an empty map when no tokens are tracked yet', async () => {
    prisma.token.findMany.mockResolvedValueOnce([]);

    await expect(service.getBalances(WALLET)).resolves.toEqual({});
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns real on-chain balances formatted using each token\'s decimals', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 2 },
    ]);
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: { __raw: 12_500_000n } } }) // 1.25 at 7 decimals
      .mockResolvedValueOnce({ result: { retval: { __raw: 500n } } }); // 5 at 2 decimals

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_A]: '1.25', [TOKEN_B]: '5' });
  });

  it('reports a genuine zero balance as "0", not by omitting the token', async () => {
    prisma.token.findMany.mockResolvedValueOnce([{ address: TOKEN_A, decimals: 7 }]);
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { __raw: 0n } },
    });

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_A]: '0' });
  });

  it('omits a token whose balance simulation itself errors, without failing the whole request', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 7 },
    ]);
    mockSimulateTransaction
      .mockResolvedValueOnce({ __error: true })
      .mockResolvedValueOnce({ result: { retval: { __raw: 10_000_000n } } });

    const result = await service.getBalances(WALLET);

    expect(result).toEqual({ [TOKEN_B]: '1' });
  });

  it('throws a 503 UpstreamServiceException when the Soroban RPC endpoint is unreachable, instead of returning a partial/empty map', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      { address: TOKEN_A, decimals: 7 },
      { address: TOKEN_B, decimals: 7 },
    ]);
    mockSimulateTransaction.mockRejectedValueOnce(new Error('fetch failed'));

    await expect(service.getBalances(WALLET)).rejects.toBeInstanceOf(
      UpstreamServiceException,
    );
  });
});
