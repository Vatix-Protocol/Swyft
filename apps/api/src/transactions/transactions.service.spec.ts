import { ConfigService } from '@nestjs/config';
import {
  InvalidInputException,
  BusinessRuleViolationException,
} from '../request-validation/http.exceptions';
import { STELLAR_CONFIG_KEY } from '../config/stellar.config';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === STELLAR_CONFIG_KEY) {
          return { horizonUrl: 'https://horizon-testnet.stellar.org' };
        }
        return undefined;
      }),
    } as unknown as ConfigService;
    service = new TransactionsService(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── XDR pre-validation (#401) ───────────────────────────────────────────

  it('throws InvalidInputException for an empty XDR string', async () => {
    await expect(service.submit('')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
  });

  it('throws InvalidInputException for non-base64 XDR', async () => {
    await expect(service.submit('not-valid!!!')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
  });

  it('throws InvalidInputException for a base64 string that is too short', async () => {
    // "AAAA" decodes to 3 bytes — below the 40-byte minimum
    await expect(service.submit('AAAA')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
  });

  it('throws InvalidInputException for base64 with invalid padding', async () => {
    // length not a multiple of 4
    await expect(service.submit('AAAAA')).rejects.toBeInstanceOf(
      InvalidInputException,
    );
  });

  // ── Horizon submission ──────────────────────────────────────────────────

  // 56 chars → length % 4 === 0 and decoded length >= 40
  const validXdr = 'A'.repeat(56);

  it('returns transaction result on success', async () => {
    const result = { hash: 'abc123', ledger: 42, successful: true };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(result),
    } as Response);

    await expect(service.submit(validXdr)).resolves.toEqual(result);
  });

  it('throws InvalidInputException for tx_malformed', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: () =>
        Promise.resolve({
          extras: { result_codes: { transaction: 'tx_malformed' } },
        }),
    } as Response);

    await expect(service.submit(validXdr)).rejects.toBeInstanceOf(
      InvalidInputException,
    );
  });

  it('throws BusinessRuleViolationException for tx_too_late', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: () =>
        Promise.resolve({
          extras: { result_codes: { transaction: 'tx_too_late' } },
        }),
    } as Response);

    await expect(service.submit(validXdr)).rejects.toBeInstanceOf(
      BusinessRuleViolationException,
    );
  });

  it('throws BusinessRuleViolationException for op_ codes (slippage)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: () =>
        Promise.resolve({
          extras: { result_codes: { transaction: 'op_underfunded' } },
        }),
    } as Response);

    await expect(service.submit(validXdr)).rejects.toBeInstanceOf(
      BusinessRuleViolationException,
    );
  });

  it('throws BusinessRuleViolationException when fetch fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    await expect(service.submit(validXdr)).rejects.toBeInstanceOf(
      BusinessRuleViolationException,
    );
  });
});
