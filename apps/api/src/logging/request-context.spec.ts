import { resolveCorrelationId } from '../observability/correlation-id';

describe('resolveCorrelationId', () => {
  it('preserves an inbound correlation id verbatim', () => {
    const inbound = 'abc-123.def:456_ghi';
    expect(resolveCorrelationId({ 'x-correlation-id': inbound })).toBe(inbound);
  });

  it('preserves an inbound request id when no correlation id is present', () => {
    const inbound = 'req-789';
    expect(resolveCorrelationId({ 'x-request-id': inbound })).toBe(inbound);
  });

  it('generates a non-empty id when none is supplied', () => {
    const generated = resolveCorrelationId(undefined);
    expect(typeof generated).toBe('string');
    expect(generated.length).toBeGreaterThan(0);
  });

  it('generates a non-empty id when the supplied value is invalid', () => {
    const generated = resolveCorrelationId({ 'x-correlation-id': 'bad id with spaces' });
    expect(generated.length).toBeGreaterThan(0);
    expect(generated).not.toBe('bad id with spaces');
  });

  it('does not share an id between two concurrent contexts', async () => {
    const first = resolveCorrelationId({ 'x-correlation-id': 'first-id' });
    const second = resolveCorrelationId({ 'x-correlation-id': 'second-id' });

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => first),
      Promise.resolve().then(() => second),
    ]);

    expect(a).toBe('first-id');
    expect(b).toBe('second-id');
    expect(a).not.toBe(b);
  });
});
