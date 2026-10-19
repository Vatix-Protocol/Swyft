import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UuidParamDto } from './uuid-param.dto';

describe('UuidParamDto (issue #1227)', () => {
  it('accepts a valid UUID v4', async () => {
    const dto = plainToInstance(UuidParamDto, {
      id: '123e4567-e89b-42d3-a456-426614174000',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-UUID string', async () => {
    const dto = plainToInstance(UuidParamDto, { id: 'not-a-uuid' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'id')).toBe(true);
  });

  it('rejects an empty string', async () => {
    const dto = plainToInstance(UuidParamDto, { id: '' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'id')).toBe(true);
  });
});
