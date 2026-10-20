import {
  ArgumentsHost,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from '../request-validation/all-exceptions.filter';
import { LiquidityOperationException } from '../request-validation/http.exceptions';
import {
  LIQUIDITY_ERROR_HTTP_STATUS,
  LiquidityDomainError,
  toLiquidityHttpException,
  translateLiquidityError,
} from './liquidity-error.map';
import { LiquidityErrorCode } from './pool.types';

function renderThroughFilter(exception: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  const reply = jest.fn();
  const filter = new AllExceptionsFilter({
    httpAdapter: { getRequestUrl: () => '/v1/pools/p1/liquidity/mint', reply },
  } as unknown as HttpAdapterHost);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/v1/pools/p1/liquidity/mint',
      }),
      getResponse: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);
  const [, body, status] = reply.mock.calls[0];
  return { status, body };
}

describe('liquidity-error.map', () => {
  const ALL_CODES = Object.values(LiquidityErrorCode);

  describe('LIQUIDITY_ERROR_HTTP_STATUS', () => {
    it('declares at least one LiquidityErrorCode', () => {
      expect(ALL_CODES.length).toBeGreaterThan(0);
    });

    it.each(ALL_CODES)('has an HTTP status for %s', (code) => {
      expect(typeof LIQUIDITY_ERROR_HTTP_STATUS[code]).toBe('number');
    });

    it('has no entries for codes that are not LiquidityErrorCode members', () => {
      expect(Object.keys(LIQUIDITY_ERROR_HTTP_STATUS).sort()).toEqual(
        [...ALL_CODES].sort(),
      );
    });

    it.each<[LiquidityErrorCode, HttpStatus]>([
      ['LP_UNAUTHORIZED', HttpStatus.FORBIDDEN],
      ['LP_INVALID_AMOUNT', HttpStatus.BAD_REQUEST],
      ['LP_INVALID_TICK_RANGE', HttpStatus.BAD_REQUEST],
      ['LP_POOL_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['LP_POOL_INACTIVE', HttpStatus.CONFLICT],
      ['LP_INSUFFICIENT_LIQUIDITY', HttpStatus.CONFLICT],
      ['LP_DEPENDENCY_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
      ['LP_REPLAY_DETECTED', HttpStatus.CONFLICT],
    ])('maps %s to %i', (code, status) => {
      expect(LIQUIDITY_ERROR_HTTP_STATUS[code]).toBe(status);
    });
  });

  describe('toLiquidityHttpException', () => {
    it.each(ALL_CODES)(
      'renders %s with its mapped status and stable code (never a 500)',
      (code) => {
        const exception = toLiquidityHttpException(
          new LiquidityDomainError(code, `failure: ${code}`, 'cid-1'),
        );

        expect(exception).toBeInstanceOf(LiquidityOperationException);
        expect(exception.getStatus()).toBe(LIQUIDITY_ERROR_HTTP_STATUS[code]);
        expect(exception.getResponse()).toEqual(
          expect.objectContaining({
            code,
            message: `failure: ${code}`,
            correlationId: 'cid-1',
          }),
        );

        const { status, body } = renderThroughFilter(exception);
        expect(status).toBe(LIQUIDITY_ERROR_HTTP_STATUS[code]);
        expect(status).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(body).toEqual(
          expect.objectContaining({
            statusCode: LIQUIDITY_ERROR_HTTP_STATUS[code],
            code,
            message: `failure: ${code}`,
          }),
        );
      },
    );

    it('omits `applied` for failures other than a replay', () => {
      const exception = toLiquidityHttpException(
        new LiquidityDomainError('LP_INSUFFICIENT_LIQUIDITY', 'nope', 'cid-2'),
      );
      expect(exception.getResponse()).not.toHaveProperty('applied');
      expect(renderThroughFilter(exception).body).not.toHaveProperty('applied');
    });
  });

  describe('replayed idempotencyKey', () => {
    const replay = new LiquidityDomainError(
      LiquidityErrorCode.LP_REPLAY_DETECTED,
      'idempotencyKey "mint-key-1" was already processed',
      'cid-replay',
    );

    it('produces LP_REPLAY_DETECTED as a 409 with applied: false', () => {
      const exception = toLiquidityHttpException(replay);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(exception.getResponse()).toEqual(
        expect.objectContaining({
          code: 'LP_REPLAY_DETECTED',
          applied: false,
          error: 'Conflict',
        }),
      );
    });

    it('keeps applied: false in the AllExceptionsFilter response body', () => {
      const { status, body } = renderThroughFilter(
        translateLiquidityError(replay, 'cid-replay'),
      );

      expect(status).toBe(409);
      expect(body).toEqual(
        expect.objectContaining({
          statusCode: 409,
          error: 'Conflict',
          code: 'LP_REPLAY_DETECTED',
          applied: false,
          path: '/v1/pools/p1/liquidity/mint',
        }),
      );
    });
  });

  describe('translateLiquidityError', () => {
    it('translates a LiquidityDomainError to its mapped exception', () => {
      const translated = translateLiquidityError(
        new LiquidityDomainError('LP_UNAUTHORIZED', 'denied', 'cid-3'),
        'cid-3',
      );
      expect(translated.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(translated.getResponse()).toEqual(
        expect.objectContaining({ code: 'LP_UNAUTHORIZED' }),
      );
    });

    it('passes an existing HttpException through unchanged', () => {
      const original = new ConflictException('already handled');
      expect(translateLiquidityError(original, 'cid-4')).toBe(original);
    });

    it('fails closed with LP_DEPENDENCY_UNAVAILABLE (503) for unknown errors', () => {
      const translated = translateLiquidityError(
        new Error('ECONNREFUSED'),
        'cid-5',
      );

      expect(translated.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(translated.getResponse()).toEqual(
        expect.objectContaining({
          code: 'LP_DEPENDENCY_UNAVAILABLE',
          correlationId: 'cid-5',
        }),
      );
      expect(JSON.stringify(translated.getResponse())).not.toContain(
        'ECONNREFUSED',
      );
    });
  });
});
