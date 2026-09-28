import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetBalancesQueryDto } from './get-balances-query.dto';

const WALLET = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

function validationErrors(value: Record<string, unknown>) {
  return validateSync(plainToInstance(GetBalancesQueryDto, value));
}

describe('GetBalancesQueryDto', () => {
  it('accepts a valid wallet with the default projection', () => {
    expect(validationErrors({ address: WALLET })).toHaveLength(0);
  });

  it('trims a wallet address before validating it', () => {
    const dto = plainToInstance(GetBalancesQueryDto, {
      address: ` ${WALLET} `,
    });

    expect(dto.address).toBe(WALLET);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['wrong prefix', `C${WALLET.slice(1)}`],
    ['wrong length', WALLET.slice(1)],
    ['lowercase', WALLET.toLowerCase()],
    ['non-base32 character', `${WALLET.slice(0, -1)}0`],
    ['invalid checksum', `G${WALLET.slice(2)}${WALLET[1]}`],
    ['non-string', ['address']],
  ])('rejects %s wallet addresses', (_case, address) => {
    expect(validationErrors({ address })).not.toHaveLength(0);
  });

  it.each(['balances', 'metadata'])('allows the "%s" projection', (view) => {
    expect(validationErrors({ address: WALLET, view })).toHaveLength(0);
  });

  it('rejects an unlisted projection', () => {
    expect(
      validationErrors({ address: WALLET, view: 'admin' }),
    ).not.toHaveLength(0);
  });

  it('accepts bounded, safe correlation identifiers and trims whitespace', () => {
    const dto = plainToInstance(GetBalancesQueryDto, {
      address: WALLET,
      correlationId: ' req-7f3c1a2b ',
    });

    expect(dto.correlationId).toBe('req-7f3c1a2b');
    expect(validateSync(dto)).toHaveLength(0);
    expect(
      validationErrors({
        address: WALLET,
        correlationId: 'a'.repeat(129),
      }),
    ).not.toHaveLength(0);
    expect(
      validationErrors({ address: WALLET, correlationId: 'bad\nvalue' }),
    ).not.toHaveLength(0);
    expect(
      validationErrors({ address: WALLET, correlationId: '   ' }),
    ).not.toHaveLength(0);
  });
});
