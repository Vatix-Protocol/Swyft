import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetTokensQueryDto } from './get-tokens-query.dto';

async function validateQuery(raw: Record<string, unknown>) {
  const dto = plainToInstance(GetTokensQueryDto, raw);
  return validate(dto);
}

describe('GetTokensQueryDto', () => {
  it('accepts limit at the maximum page size', async () => {
    const errors = await validateQuery({ limit: 100 });
    expect(errors).toHaveLength(0);
  });

  it('rejects limit above the maximum page size', async () => {
    const errors = await validateQuery({ limit: 101 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('rejects a non-positive limit', async () => {
    const errors = await validateQuery({ limit: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('rejects a non-positive page', async () => {
    const errors = await validateQuery({ page: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('applies defaults when omitted', () => {
    const dto = plainToInstance(GetTokensQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(50);
  });
});
