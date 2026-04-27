import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'zlib';

const MIN_SIZE = 1024; // 1 KB
const LEVEL = Number(process.env.COMPRESSION_LEVEL ?? 6);

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Skip WebSocket upgrades and health checks
    if (req.headers.upgrade === 'websocket' || req.path === '/health') {
      return next();
    }

    const acceptEncoding = (req.headers['accept-encoding'] as string) ?? '';
    const preferBrotli = acceptEncoding.includes('br');
    const acceptGzip = acceptEncoding.includes('gzip');

    if (!preferBrotli && !acceptGzip) return next();

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const chunks: Buffer[] = [];

    // Buffer the response body
    res.write = (chunk: unknown, ...args: unknown[]) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    };

    res.end = (chunk?: unknown, ...args: unknown[]) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      const body = Buffer.concat(chunks);

      if (body.length < MIN_SIZE) {
        // Too small — send uncompressed
        res.write = originalWrite;
        res.end = originalEnd;
        originalEnd(body);
        return res;
      }

      if (preferBrotli) {
        res.setHeader('Content-Encoding', 'br');
        res.removeHeader('Content-Length');
        const brotli = createBrotliCompress({
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: LEVEL },
        });
        brotli.end(body);
        const compressed: Buffer[] = [];
        brotli.on('data', (d: Buffer) => compressed.push(d));
        brotli.on('end', () => {
          res.write = originalWrite;
          res.end = originalEnd;
          originalEnd(Buffer.concat(compressed));
        });
      } else {
        res.setHeader('Content-Encoding', 'gzip');
        res.removeHeader('Content-Length');
        const gzip = createGzip({ level: LEVEL });
        gzip.end(body);
        const compressed: Buffer[] = [];
        gzip.on('data', (d: Buffer) => compressed.push(d));
        gzip.on('end', () => {
          res.write = originalWrite;
          res.end = originalEnd;
          originalEnd(Buffer.concat(compressed));
        });
      }

      return res;
    };

    next();
  }
}
