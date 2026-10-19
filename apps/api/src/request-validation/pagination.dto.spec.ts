import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PaginationQueryDto, SortOrder } from './pagination.dto';

describe('PaginationQueryDto', () => {
  const build = (input: Record<string, unknown> = {}) =>
    plainToInstance(PaginationQueryDto, input);

  it('applies the documented defaults when the query object is empty', async () => {
    const dto = build();

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortOrder).toBe(SortOrder.DESC);

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid page, limit and sortOrder', async () => {
    const dto = build({ page: 3, limit: 50, sortOrder: SortOrder.ASC });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
    expect(dto.sortOrder).toBe(SortOrder.ASC);

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a limit above the maximum', async () => {
    const dto = build({ limit: 101 });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('rejects negative page and limit values', async () => {
    const dto = build({ page: -1, limit: -5 });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);
    expect(properties).toContain('page');
    expect(properties).toContain('limit');
  });

  it('rejects non-integer page and limit values', async () => {
    const dto = build({ page: 1.5, limit: 10.5 });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);
    expect(properties).toContain('page');
    expect(properties).toContain('limit');
  });

  it('rejects an unknown sortOrder value', async () => {
    const dto = build({ sortOrder: 'sideways' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'sortOrder')).toBe(true);
  });

  it('rejects a limit of 0', async () => {
    const dto = build({ limit: 0 });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('rejects a non-numeric limit value', async () => {
    const dto = build({ limit: 'abc' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });
});
