import { CompressionMiddleware } from './compression.middleware';

function response(contentType: string, contentEncoding?: string) {
  const headers = new Map<string, string>();
  headers.set('Content-Type', contentType);
  if (contentEncoding) headers.set('Content-Encoding', contentEncoding);

  const chunks: Buffer[] = [];
  const res = {
    write: jest.fn((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }),
    end: jest.fn((chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      return res;
    }),
    getHeader: jest.fn((name: string) => headers.get(name)),
    setHeader: jest.fn((name: string, value: string) =>
      headers.set(name, value),
    ),
    removeHeader: jest.fn((name: string) => headers.delete(name)),
    vary: jest.fn(),
  };

  return { res, headers, chunks };
}

describe('CompressionMiddleware', () => {
  const body = Buffer.alloc(2048, 'a');

  it('leaves already-compressed responses unchanged', () => {
    const { res, headers, chunks } = response('application/json', 'gzip');
    const next = jest.fn(() => res.end(body));

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'br' }, path: '/v1/pools' } as never,
      res as never,
      next,
    );

    expect(Buffer.concat(chunks)).toEqual(body);
    expect(headers.get('Content-Encoding')).toBe('gzip');
  });

  it('does not compress binary responses', () => {
    const { res, headers, chunks } = response('application/octet-stream');
    const next = jest.fn(() => res.end(body));

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'gzip' }, path: '/download' } as never,
      res as never,
      next,
    );

    expect(Buffer.concat(chunks)).toEqual(body);
    expect(headers.has('Content-Encoding')).toBe(false);
  });

  it('does not intercept health responses', () => {
    const { res } = response('application/json');
    const originalEnd = res.end;
    const next = jest.fn();

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'gzip' }, path: '/health' } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.end).toBe(originalEnd);
  });
});
