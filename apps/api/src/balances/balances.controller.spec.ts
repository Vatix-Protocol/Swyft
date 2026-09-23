import { BalancesController } from './balances.controller';

describe('BalancesController', () => {
  const balancesService = { getBalances: jest.fn() };
  const WALLET = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

  beforeEach(() => {
    balancesService.getBalances.mockReset();
  });

  it('delegates to BalancesService.getBalances with the address from the query', async () => {
    balancesService.getBalances.mockResolvedValueOnce({ TOKEN_A: '1.25' });
    const controller = new BalancesController(balancesService as never);

    await expect(
      controller.getBalances({ address: WALLET }),
    ).resolves.toEqual({ TOKEN_A: '1.25' });
    expect(balancesService.getBalances).toHaveBeenCalledWith(WALLET);
  });

  it('propagates errors thrown by the service (invalid address, upstream RPC failure, etc.)', async () => {
    const err = new Error('boom');
    balancesService.getBalances.mockRejectedValueOnce(err);
    const controller = new BalancesController(balancesService as never);

    await expect(controller.getBalances({ address: 'bad' })).rejects.toThrow(
      'boom',
    );
  });
});
