import { InvalidInputException, BusinessRuleViolationException } from '../request-validation/http.exceptions';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(() => {
    service = new TransactionsService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns transaction result on success', async () => {
    const result = { hash: 'abc123', ledger: 42, successful: true };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(result),
    } as Response);

    await expect(service.submit('AXDR==')).resolves.toEqual(result);
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

    await expect(service.submit('bad')).rejects.toBeInstanceOf(InvalidInputException);
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

    await expect(service.submit('old')).rejects.toBeInstanceOf(BusinessRuleViolationException);
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

    await expect(service.submit('slip')).rejects.toBeInstanceOf(BusinessRuleViolationException);
  });

  it('throws BusinessRuleViolationException when fetch fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    await expect(service.submit('xdr')).rejects.toBeInstanceOf(BusinessRuleViolationException);
  });
});
