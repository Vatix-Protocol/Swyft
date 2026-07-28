import { RequestContext } from './request-context';

describe('RequestContext', () => {
  it('returns undefined outside of a run() scope', () => {
    expect(RequestContext.requestId).toBeUndefined();
  });

  it('exposes the requestId within a run() scope', () => {
    RequestContext.run({ requestId: 'req-1' }, () => {
      expect(RequestContext.requestId).toBe('req-1');
    });
  });

  it('clears the requestId once the scope has exited', () => {
    RequestContext.run({ requestId: 'req-2' }, () => {
      expect(RequestContext.requestId).toBe('req-2');
    });
    expect(RequestContext.requestId).toBeUndefined();
  });

  it('propagates through nested async calls within the same scope', async () => {
    await RequestContext.run({ requestId: 'req-3' }, async () => {
      await Promise.resolve();
      expect(RequestContext.requestId).toBe('req-3');
    });
  });

  it('isolates concurrent scopes from each other', async () => {
    const results: string[] = [];

    await Promise.all([
      RequestContext.run({ requestId: 'a' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(RequestContext.requestId!);
      }),
      RequestContext.run({ requestId: 'b' }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push(RequestContext.requestId!);
      }),
    ]);

    expect(results.sort()).toEqual(['a', 'b']);
  });
});
